import { v4 as uuidv4 } from 'uuid'
import logger from '../../util/logger'
import { Execute } from '../../messages/Blade'
import { CallState, CallType, CALL_STATES, DisconnectReason, Notification, RecordState, PlayState, PlayType, PromptState, ConnectState, FaxState, DetectState, DetectType, TapState, SendDigitsState } from './constants'
import { ICall, IDevice, ICallOptions, IMakeCallParams, ICallingPlay, ICallingPlayParams, ICallingCollect, DeepArray, ICallingDetect, ICallingTapTap, ICallingTapDevice, ICallingRecord, IRelayCallingPlay, ICallingPlayRingtone, ICallingPlayTTS, ICallingCollectAudio, ICallingCollectTTS, ICallingTapFlat, ICallingCollectRingtone, ICallingConnectParams, ICallPeer, IRelayDevice } from './interfaces'
import { prepareRecordParams, preparePlayParams, preparePlayAudioParams, preparePromptParams, preparePromptAudioParams, preparePromptTTSParams, prepareTapParams, preparePromptRingtoneParams, prepareConnectParams, prepareDevices } from '../helpers'
import Calling from './Calling'
import { isFunction } from '../../util/helpers'
import { Answer, Await, BaseComponent, Connect, Detect, Dial, FaxReceive, FaxSend, Hangup, Play, Prompt, Record, SendDigits, Tap, Disconnect } from './components'
import { RecordAction, PlayAction, PromptAction, ConnectAction, FaxAction, DetectAction, TapAction, SendDigitsAction } from './actions'
import { HangupResult, RecordResult, AnswerResult, PlayResult, PromptResult, ConnectResult, DialResult, FaxResult, DetectResult, TapResult, SendDigitsResult, DisconnectResult } from './results'
import { buildDevice } from './devices'

export default class Call implements ICall {
  public id: string
  public tag: string = uuidv4()
  public nodeId: string
  public state: string = CallState.None
  public prevState: string = CallState.None
  public targets: DeepArray<IDevice> = []
  public attemptedDevices: IDevice[] = []
  public device: IDevice = null
  public failed: boolean = false
  public busy: boolean = false
  public amd: Function
  public amdAsync: Function

  private _cbQueue: { [state: string]: Function } = {}
  private _components: BaseComponent[] = []

  constructor(public relayInstance: Calling, protected options: ICallOptions) {
    const { call_id, node_id, targets = [] } = options
    this.id = call_id
    this.nodeId = node_id
    this.targets = targets
    this.amd = this.detectAnsweringMachine.bind(this)
    this.amdAsync = this.detectAnsweringMachineAsync.bind(this)
    this.relayInstance.addCall(this)
  }

  get answered(): boolean {
    return this.state === CallState.Answered
  }

  get active(): boolean {
    return !this.ended
  }

  get ended(): boolean {
    return this.state === CallState.Ending || this.state === CallState.Ended
  }

  get context() {
    return this.options.context
  }

  get peer(): Call {
    const { peer: { call_id = null } = {} } = this.options
    return this.relayInstance.getCallById(call_id)
  }

  get ready(): boolean {
    return Boolean(this.id)
  }

  get type(): CallType {
    return this.device ? this.device.type : null
  }

  get from(): string {
    return this.device ? this.device.from : null
  }

  get to(): string {
    return this.device ? this.device.to : null
  }

  get timeout(): number {
    return this.device ? this.device.params.timeout : null
  }

  setOptions(opts: ICallOptions) {
    this.options = { ...this.options, ...opts }
  }

  async _execute(msg: Execute) {
    try {
      return await this.relayInstance.session.execute(msg)
    } catch (error) {
      logger(`Relay command failed with code: ${error.code} - ${error.message}`)
      throw error
    }
  }

  async dial() {
    const component = new Dial(this)
    this._addComponent(component)
    await component._waitFor(CallState.Answered, CallState.Ending, CallState.Ended)

    return new DialResult(component)
  }

  async disconnect() {
    const component = new Disconnect(this)
    this._addComponent(component)
    await component._waitFor(ConnectState.Failed, ConnectState.Disconnected)

    return new DisconnectResult(component)
  }

  async hangup(reason: string = DisconnectReason.Hangup) {
    const component = new Hangup(this, reason)
    this._addComponent(component)
    await component._waitFor(CallState.Ended)

    return new HangupResult(component)
  }

  async answer() {
    const component = new Answer(this)
    this._addComponent(component)
    await component._waitFor(CallState.Answered, CallState.Ending, CallState.Ended)

    return new AnswerResult(component)
  }

  async record(record: ICallingRecord = {}) {
    const component = new Record(this, prepareRecordParams(record))
    this._addComponent(component)
    await component._waitFor(RecordState.NoInput, RecordState.Finished)

    return new RecordResult(component)
  }

  async recordAsync(record: ICallingRecord = {}) {
    const component = new Record(this, prepareRecordParams(record))
    this._addComponent(component)
    const { url } = await component.execute()
    component.url = url

    return new RecordAction(component)
  }

  async play(...params: [ICallingPlayParams] | (IRelayCallingPlay | ICallingPlay)[]): Promise<PlayResult> {
    const [play, volume] = preparePlayParams(params)
    const component = new Play(this, play, volume)
    this._addComponent(component)
    await component._waitFor(PlayState.Error, PlayState.Finished)

    return new PlayResult(component)
  }

  async playAsync(...params: [ICallingPlayParams] | (IRelayCallingPlay | ICallingPlay)[]): Promise<PlayAction> {
    const [play, volume] = preparePlayParams(params)
    const component = new Play(this, play, volume)
    this._addComponent(component)
    await component.execute()

    return new PlayAction(component)
  }

  playAudio(params: string | { url: string, volume?: number }): Promise<PlayResult> {
    const [url, volume] = preparePlayAudioParams(params)
    const media = [{ type: PlayType.Audio, params: { url } }]
    return this.play({ media, volume })
  }

  playAudioAsync(params: string | { url: string, volume?: number }): Promise<PlayAction> {
    const [url, volume] = preparePlayAudioParams(params)
    const media = [{ type: PlayType.Audio, params: { url } }]
    return this.playAsync({ media, volume })
  }

  playSilence(duration: number): Promise<PlayResult> {
    return this.play({ type: PlayType.Silence, params: { duration } })
  }

  playSilenceAsync(duration: number): Promise<PlayAction> {
    return this.playAsync({ type: PlayType.Silence, params: { duration } })
  }

  playRingtone(params: ICallingPlayRingtone): Promise<PlayResult> {
    const { volume = 0 } = params
    delete params.volume
    const media = [{ type: PlayType.Ringtone, params }]
    return this.play({ media, volume })
  }

  playRingtoneAsync(params: ICallingPlayRingtone): Promise<PlayAction> {
    const { volume = 0 } = params
    delete params.volume
    const media = [{ type: PlayType.Ringtone, params }]
    return this.playAsync({ media, volume })
  }

  playTTS(params: ICallingPlayTTS): Promise<PlayResult> {
    const { volume = 0 } = params
    delete params.volume
    const media = [{ type: PlayType.TTS, params }]
    return this.play({ media, volume })
  }

  playTTSAsync(params: ICallingPlayTTS): Promise<PlayAction> {
    const { volume = 0 } = params
    delete params.volume
    const media = [{ type: PlayType.TTS, params }]
    return this.playAsync({ media, volume })
  }

  async prompt(params: ICallingCollect, ...mediaList: (IRelayCallingPlay | ICallingPlay)[]): Promise<PromptResult> {
    const [collect, play, volume] = preparePromptParams(params, mediaList)
    const component = new Prompt(this, collect, play, volume)
    this._addComponent(component)
    await component._waitFor(PromptState.Error, PromptState.NoInput, PromptState.NoMatch, PromptState.Digit, PromptState.Speech)

    return new PromptResult(component)
  }

  async promptAsync(params: ICallingCollect, ...mediaList: (IRelayCallingPlay | ICallingPlay)[]): Promise<PromptAction> {
    const [collect, play, volume] = preparePromptParams(params, mediaList)
    const component = new Prompt(this, collect, play, volume)
    this._addComponent(component)
    await component.execute()

    return new PromptAction(component)
  }

  promptAudio(params: ICallingCollectAudio, url: string = ''): Promise<PromptResult> {
    const collect = preparePromptAudioParams(params, url)
    return this.prompt(collect)
  }

  promptAudioAsync(params: ICallingCollectAudio, url: string = ''): Promise<PromptAction> {
    const collect = preparePromptAudioParams(params, url)
    return this.promptAsync(collect)
  }

  promptRingtone(params: ICallingCollectRingtone): Promise<PromptResult> {
    const collect = preparePromptRingtoneParams(params)
    return this.prompt(collect)
  }

  promptRingtoneAsync(params: ICallingCollectRingtone): Promise<PromptAction> {
    const collect = preparePromptRingtoneParams(params)
    return this.promptAsync(collect)
  }

  promptTTS(params: ICallingCollectTTS, ttsOptions: ICallingPlayTTS = { text: '' }): Promise<PromptResult> {
    const collect = preparePromptTTSParams(params, ttsOptions)
    return this.prompt(collect)
  }

  promptTTSAsync(params: ICallingCollectTTS, ttsOptions: ICallingPlayTTS = { text: '' }): Promise<PromptAction> {
    const collect = preparePromptTTSParams(params, ttsOptions)
    return this.promptAsync(collect)
  }

  async connect(...params: [ICallingConnectParams] | DeepArray<IMakeCallParams>): Promise<ConnectResult> {
    const [devices, ringback] = prepareConnectParams(params, this.from, this.timeout)
    const component = new Connect(this, devices, ringback)
    this._addComponent(component)
    await component._waitFor(ConnectState.Failed, ConnectState.Connected)

    return new ConnectResult(component)
  }

  async connectAsync(...params: [ICallingConnectParams] | DeepArray<IMakeCallParams>): Promise<ConnectAction> {
    const [devices, ringback] = prepareConnectParams(params, this.from, this.timeout)
    const component = new Connect(this, devices, ringback)
    this._addComponent(component)
    await component.execute()

    return new ConnectAction(component)
  }

  async waitFor(...events: string[]): Promise<boolean> {
    if (!events.length) {
      events = [CallState.Ended]
    }
    const currentStateIndex = CALL_STATES.indexOf(this.state)
    for (let i = 0; i < events.length; i++) {
      const index = CALL_STATES.indexOf(events[i])
      if (index <= currentStateIndex) {
        return true
      }
    }
    const component = new Await(this)
    this._addComponent(component)
    await component._waitFor(...events)

    return component.successful
  }

  waitForRinging() {
    return this.waitFor(CallState.Ringing)
  }

  waitForAnswered() {
    return this.waitFor(CallState.Answered)
  }

  waitForEnding() {
    return this.waitFor(CallState.Ending)
  }

  waitForEnded() {
    return this.waitFor(CallState.Ended)
  }

  async faxReceive(): Promise<FaxResult> {
    const component = new FaxReceive(this)
    this._addComponent(component)
    await component._waitFor(FaxState.Error, FaxState.Finished)

    return new FaxResult(component)
  }

  async faxReceiveAsync(): Promise<FaxAction> {
    const component = new FaxReceive(this)
    this._addComponent(component)
    await component.execute()

    return new FaxAction(component)
  }

  async faxSend(document: string, identity: string = null, header: string = null): Promise<FaxResult> {
    const component = new FaxSend(this, document, identity, header)
    this._addComponent(component)
    await component._waitFor(FaxState.Error, FaxState.Finished)

    return new FaxResult(component)
  }

  async faxSendAsync(document: string, identity: string = null, header: string = null): Promise<FaxAction> {
    const component = new FaxSend(this, document, identity, header)
    this._addComponent(component)
    await component.execute()

    return new FaxAction(component)
  }

  async detect(options: ICallingDetect): Promise<DetectResult> {
    const { type, timeout, wait_for_beep = false, ...params } = options
    const component = new Detect(this, { type, params }, timeout, wait_for_beep)
    this._addComponent(component)
    await component._waitFor(DetectState.Machine, DetectState.Human, DetectState.Unknown, DetectState.CED, DetectState.CNG)

    return new DetectResult(component)
  }

  async detectAsync(options: ICallingDetect): Promise<DetectAction> {
    const { type, timeout, ...params } = options
    const component = new Detect(this, { type, params }, timeout)
    this._addComponent(component)
    await component.execute()

    return new DetectAction(component)
  }

  detectAnsweringMachine(params: ICallingDetect = {}): Promise<DetectResult> {
    params.type = DetectType.Machine
    return this.detect(params)
  }

  detectAnsweringMachineAsync(params: ICallingDetect = {}): Promise<DetectAction> {
    params.type = DetectType.Machine
    return this.detectAsync(params)
  }

  /**
   * @deprecated Since version 2.2. Will be deleted in version 3.0. Use detectAnsweringMachine instead.
   */
  async detectHuman(params: ICallingDetect = {}): Promise<DetectResult> {
    logger('detectHuman has been deprecated: use detectAnsweringMachine instead.')
    params.type = DetectType.Machine
    const result = await this.detect(params)
    result.component.successful = result.component.result === DetectState.Human
    return result
  }

  /**
   * @deprecated Since version 2.2. Will be deleted in version 3.0. Use detectAnsweringMachineAsync instead.
   */
  detectHumanAsync(params: ICallingDetect = {}): Promise<DetectAction> {
    logger('detectHumanAsync has been deprecated: use detectAnsweringMachineAsync instead.')
    params.type = DetectType.Machine
    return this.detectAsync(params)
  }

  /**
   * @deprecated Since version 2.2. Will be deleted in version 3.0. Use detectAnsweringMachine instead.
   */
  async detectMachine(params: ICallingDetect = {}): Promise<DetectResult> {
    logger('detectMachine has been deprecated: use detectAnsweringMachine instead.')
    params.type = DetectType.Machine
    const result = await this.detect(params)
    result.component.successful = result.component.result === DetectState.Machine
    return result
  }

  /**
   * @deprecated Since version 2.2. Will be deleted in version 3.0. Use detectAnsweringMachineAsync instead.
   */
  detectMachineAsync(params: ICallingDetect = {}): Promise<DetectAction> {
    logger('detectMachineAsync has been deprecated: use detectAnsweringMachineAsync instead.')
    params.type = DetectType.Machine
    return this.detectAsync(params)
  }

  detectFax({ tone, timeout }: ICallingDetect = {}): Promise<DetectResult> {
    return this.detect({ type: DetectType.Fax, tone, timeout })
  }

  detectFaxAsync({ tone, timeout }: ICallingDetect = {}): Promise<DetectAction> {
    return this.detectAsync({ type: DetectType.Fax, tone, timeout })
  }

  detectDigit({ digits, timeout }: ICallingDetect = {}): Promise<DetectResult> {
    return this.detect({ type: DetectType.Digit, digits, timeout })
  }

  detectDigitAsync({ digits, timeout }: ICallingDetect = {}): Promise<DetectAction> {
    return this.detectAsync({ type: DetectType.Digit, digits, timeout })
  }

  async tap(params: (ICallingTapTap | ICallingTapFlat), deprecatedDevice: ICallingTapDevice = {}): Promise<TapResult> {
    const { tap, device } = prepareTapParams(params, deprecatedDevice)
    const component = new Tap(this, tap, device)
    this._addComponent(component)
    await component._waitFor(TapState.Finished)

    return new TapResult(component)
  }

  async tapAsync(params: (ICallingTapTap | ICallingTapFlat), deprecatedDevice: ICallingTapDevice = {}): Promise<TapAction> {
    const { tap, device } = prepareTapParams(params, deprecatedDevice)
    const component = new Tap(this, tap, device)
    this._addComponent(component)
    await component.execute()

    return new TapAction(component)
  }

  async sendDigits(digits: string): Promise<SendDigitsResult> {
    const component = new SendDigits(this, digits)
    this._addComponent(component)
    await component._waitFor(SendDigitsState.Finished)

    return new SendDigitsResult(component)
  }

  async sendDigitsAsync(digits: string): Promise<SendDigitsAction> {
    const component = new SendDigits(this, digits)
    this._addComponent(component)
    await component.execute()

    return new SendDigitsAction(component)
  }

  /**
   * Registers a callback to dispatch when the 'event' occur.
   * @param event - Event to listen to.
   * @param callback - Function to dispatch.
   * @return this
   */
  on(event: string, callback: Function) {
    this._cbQueue[event] = callback
    return this
  }

  /**
   * Removes the callback registered for the 'event'.
   * @param event - Event to listen to.
   * @param callback - Function to remove.
   * @return this
   */
  off(event: string, callback?: Function) {
    delete this._cbQueue[event]
    return this
  }

  _stateChange(params: { call_state: string, end_reason?: string, device: IRelayDevice }) {
    const { call_state, end_reason, device } = params
    this.prevState = this.state
    this.state = call_state
    this._notifyComponents(Notification.State, this.tag, params)
    this._dispatchCallback('stateChange')
    this._dispatchCallback(call_state)
    switch (this.state) {
      case CallState.Created: {
        this.attemptedDevices.push(buildDevice(device))
        break
      }
      case CallState.Answered: {
        this.device = buildDevice(device)
        break
      }
      case CallState.Ended:
        this.busy = end_reason === DisconnectReason.Busy
        this.failed = end_reason === DisconnectReason.Error
        this._terminateComponents(params)
        this.relayInstance.removeCall(this)
        break
    }
  }

  _connectChange(params: { connect_state: string, peer?: ICallPeer }) {
    const { connect_state, peer } = params
    switch (connect_state) {
      case ConnectState.Connected:
        if (peer) {
          this.setOptions({ peer })
        }
        break
      case ConnectState.Disconnected:
        this.setOptions({ peer: undefined })
        break
    }
    this._notifyComponents(Notification.Connect, this.tag, params)
    this._dispatchCallback('connect.stateChange')
    this._dispatchCallback(`connect.${connect_state}`)
  }

  _recordChange(params: any) {
    this._notifyComponents(Notification.Record, params.control_id, params)
    this._dispatchCallback('record.stateChange', params)
    this._dispatchCallback(`record.${params.state}`, params)
  }

  _playChange(params: any) {
    this._notifyComponents(Notification.Play, params.control_id, params)
    this._dispatchCallback('play.stateChange', params)
    this._dispatchCallback(`play.${params.state}`, params)
  }

  _collectChange(params: any) {
    this._notifyComponents(Notification.Collect, params.control_id, params)
    this._dispatchCallback('collect', params)
  }

  _faxChange(params: any) {
    this._notifyComponents(Notification.Fax, params.control_id, params)
    this._dispatchCallback('fax.stateChange', params)
    if (params.fax && params.fax.type) {
      this._dispatchCallback(`fax.${params.fax.type}`, params)
    }
  }

  _detectChange(params: any) {
    this._notifyComponents(Notification.Detect, params.control_id, params)

    const { params: { event = null } } = params.detect
    if (event === DetectState.Finished || event === DetectState.Error) {
      this._dispatchCallback(`detect.${event}`, params)
    } else if (event) {
      this._dispatchCallback('detect.update', params)
    }
  }

  _tapChange(params: any) {
    this._notifyComponents(Notification.Tap, params.control_id, params)
    this._dispatchCallback(`tap.${params.state}`, params)
  }

  _sendDigitsChange(params: any) {
    this._notifyComponents(Notification.SendDigits, params.control_id, params)
    this._dispatchCallback(`sendDigits.stateChange`, params)
    this._dispatchCallback(`sendDigits.${params.state}`, params)
  }

  private _notifyComponents(eventType: string, controlId: string, params: any): void {
    this._components.forEach(component => {
      if (component.completed === false && component.eventType === eventType && component.controlId === controlId) {
        component.notificationHandler(params)
      }
    })
  }

  private _terminateComponents(params: any): void {
    this._components.forEach(component => {
      if (component.completed === false) {
        component.terminate(params)
      }
    })
  }

  private _addComponent(component: BaseComponent): void {
    this._components.push(component)
  }

  private _dispatchCallback(key: string, ...params: any) {
    const { [key]: handler } = this._cbQueue
    if (isFunction(handler)) {
      handler(this, ...params)
      return true
    }
    return false
  }
}

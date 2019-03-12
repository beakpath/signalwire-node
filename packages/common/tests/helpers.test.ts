import { objEmpty, mutateLiveArrayData, safeParseJson, isDefined } from '../src/util/helpers'

describe('Helpers functions', () => {
  describe('objEmpty', () => {
    it('should return true if object has no values', () => {
      const tmp = { test: 1234 }
      expect(objEmpty(tmp)).toEqual(false)

      const tmp1 = {}
      expect(objEmpty(tmp1)).toEqual(true)
    })
  })

  describe('mutateLiveArrayData', () => {
    it('should filter data from liveArray', () => {
      const data = JSON.parse('["0067","email@domain.com","Js Client Test","opus@48000","{\\"audio\\":{\\"muted\\":false,\\"deaf\\":false,\\"onHold\\":false,\\"talking\\":true,\\"floor\\":true,\\"energyScore\\":1159},\\"video\\":{\\"visible\\":true,\\"videoOnly\\":false,\\"avatarPresented\\":false,\\"mediaFlow\\":\\"sendRecv\\",\\"muted\\":false,\\"floor\\":true,\\"reservationID\\":null,\\"roleID\\":null,\\"videoLayerID\\":1},\\"oldStatus\\":\\"TALKING (FLOOR) VIDEO (FLOOR)\\"}",{"email":"email","avatar":"avatar"},null]')
      const media = JSON.parse('{"audio":{"muted":false,"deaf":false,"onHold":false,"talking":true,"floor":true,"energyScore":1159},"video":{"visible":true,"videoOnly":false,"avatarPresented":false,"mediaFlow":"sendRecv","muted":false,"floor":true,"reservationId":null,"roleId":null,"videoLayerId":1},"oldStatus":"TALKING (FLOOR) VIDEO (FLOOR)"}')
      expect(mutateLiveArrayData(data)).toMatchObject({ participantId: 67, participantNumber: 'email@domain.com', participantName: 'Js Client Test', codec: 'opus@48000', media, participantData: { email: 'email', avatar: 'avatar' } })
    })
  })

  describe('safeParseJson', () => {
    it('should parse a valid JSON string', () => {
      const jsonString = '{"jsonrpc":"2.0","id":"fb5daf53-14f9-4972-8ece-310824054da8","method":"blade.execute"}'
      expect(safeParseJson(jsonString)).toMatchObject({ jsonrpc: '2.0', id: 'fb5daf53-14f9-4972-8ece-310824054da8', method: 'blade.execute'})
    })

    it('return the input parameter if its not a string', () => {
      const obj = { jsonrpc: '2.0', id: 'fb5daf53-14f9-4972-8ece-310824054da8', method: 'blade.execute' }
      // @ts-ignore
      expect(safeParseJson(obj)).toMatchObject({ jsonrpc: '2.0', id: 'fb5daf53-14f9-4972-8ece-310824054da8', method: 'blade.execute'})
      // @ts-ignore
      expect(safeParseJson(null)).toEqual(null)
      // @ts-ignore
      expect(safeParseJson(true)).toEqual(true)
    })
  })

  describe('isDefined', () => {
    it('should return true if the variable is defined', () => {
      const obj = { key: 'value' }
      expect(isDefined(obj.key)).toEqual(true)
    })

    it('should return false if the variable is undefined', () => {
      const obj = { key: 'value' }
      // @ts-ignore
      expect(isDefined(obj.key2)).toEqual(false)
      expect(isDefined(undefined)).toEqual(false)
      delete obj.key
      expect(isDefined(obj.key)).toEqual(false)
    })
  })
})
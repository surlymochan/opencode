import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const run = (code: string) => Effect.runPromise(CodeMode.execute({ code, tools: {} }))
const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe("Uint8Array.from mapping", () => {
  test("maps original values with their indexes before converting to bytes", async () => {
    expect(await value(`return [...Uint8Array.from([300, 2], (item, index) => item / 2 + index)]`)).toEqual([150, 2])
    expect(await value(`return [...Uint8Array.from([1, 2], item => item * 200)]`)).toEqual([200, 144])
  })

  test("passes thisArg and the two mapper arguments", async () => {
    expect(
      await value(`
      const context = { offset: 5 }
      return [...Uint8Array.from([1, 2], function(item, index) {
        return item + index + this.offset + (arguments.length === 2 ? 0 : 100)
      }, context)]
    `),
    ).toEqual([6, 8])
  })

  test("collects an iterable before calling its mapper", async () => {
    expect(
      await value(`
      const events = []
      function* source() {
        events.push("yield1")
        yield 300
        events.push("yield2")
        yield 2
        events.push("done")
      }
      const bytes = Uint8Array.from(source(), (item, index) => {
        events.push("map" + index)
        return item / 2
      })
      return [[...bytes], events]
    `),
    ).toEqual([
      [150, 1],
      ["yield1", "yield2", "done", "map0", "map1"],
    ])
  })

  test("maps holes, string iterables, and existing bytes without changing the source", async () => {
    expect(
      await value(`
      const source = new Uint8Array([1, 2])
      return [
        [...Uint8Array.from([, 2], item => item === undefined ? 9 : item)],
        [...Uint8Array.from("12", item => Number(item) * 2)],
        [...Uint8Array.from(source, item => item + 1)],
        [...source],
        [...Uint8Array.from(source)],
      ]
    `),
    ).toEqual([
      [9, 2],
      [2, 4],
      [2, 3],
      [1, 2],
      [1, 2],
    ])
  })

  test("rejects non-callable mappers before consuming the source", async () => {
    expect(
      await value(`
      let consumed = false
      function* source() { consumed = true; yield 1 }
      try { Uint8Array.from(source(), 42) }
      catch (error) { return [error.name, consumed] }
      return ["no error", consumed]
    `),
    ).toEqual(["TypeError", false])
  })

  test("converts mapped objects through valueOf before storing each byte", async () => {
    expect(
      await value(`
      const events = []
      const bytes = Uint8Array.from([1, 2], item => {
        events.push("map" + item)
        return { valueOf() { events.push("convert" + item); return item + 6 } }
      })
      return [[...bytes], events]
    `),
    ).toEqual([
      [7, 8],
      ["map1", "convert1", "map2", "convert2"],
    ])
  })

  test("propagates mapped valueOf failures without mapping later items", async () => {
    expect(
      await value(`
      const calls = []
      try {
        Uint8Array.from([1, 2], item => {
          calls.push(item)
          return { valueOf() { throw new Error("mapper conversion failed") } }
        })
      } catch (error) { return [error.message, calls] }
      return ["no error", calls]
    `),
    ).toEqual(["mapper conversion failed", [1]])
  })

  test("preserves mapper failures and stops mapping", async () => {
    expect(
      await value(`
      const calls = []
      try {
        Uint8Array.from([1, 2, 3], item => {
          calls.push(item)
          if (item === 2) throw new Error("mapper failed")
          return item
        })
      } catch (error) { return [error.message, calls] }
      return ["no error", calls]
    `),
    ).toEqual(["mapper failed", [1, 2]])
  })
})

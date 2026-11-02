import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { speechText, pickVoice } from '../src/renderer/src/components/mascot/speech'

describe('speechText: what the mascot reads aloud', () => {
  test('strips markdown emphasis and headings', () => {
    assert.equal(speechText('# Summary\n**Sales** are up.'), 'Summary. Sales are up.')
  })

  test('links keep their text, bare URLs disappear', () => {
    assert.equal(speechText('See [the report](https://x.y/z). More at https://a.b/c today.'), 'See the report. More at today.')
  })

  test('fenced code and table lines are not read', () => {
    const a = 'Here is the breakdown.\n```sql\nselect 1\n```\n| Item | Nett |\n|---|---|\n| A | 1 |\nTotal is IDR 4.1B.'
    assert.equal(speechText(a), 'Here is the breakdown. Total is IDR 4.1B.')
  })

  test('bullets are read as sentences', () => {
    assert.equal(speechText('Top items:\n- PCR panel\n- HPV test'), 'Top items: PCR panel. HPV test.')
  })

  test('at most three sentences', () => {
    assert.equal(speechText('One. Two. Three. Four. Five.'), 'One. Two. Three.')
  })

  test('at most 400 characters, cut at a sentence end', () => {
    const s = ('A'.repeat(150) + '. ').repeat(3)
    const out = speechText(s)
    assert.ok(out.length <= 400, String(out.length))
    assert.match(out, /\.$/)
  })

  test('a single sentence longer than 400 characters is cut at a word', () => {
    const out = speechText(('word ').repeat(120))
    assert.ok(out.length <= 400)
    assert.doesNotMatch(out, /wor$/)
  })

  test('an answer that is only a table or code says something sensible', () => {
    assert.equal(speechText('| A | B |\n|---|---|\n| 1 | 2 |'), 'Here are the results.')
    assert.equal(speechText('```\nx = 1\n```'), 'Here are the results.')
    assert.equal(speechText(''), 'Here are the results.')
  })

  test('decimal numbers are not sentence breaks', () => {
    assert.equal(speechText('Sales were IDR 4.1B. Orders rose 12.5% this month. Good.'), 'Sales were IDR 4.1B. Orders rose 12.5% this month. Good.')
  })
})

describe('pickVoice', () => {
  test('prefers Zira, then David, then any en-US, then any en', () => {
    assert.match(pickVoice([{ name: 'Microsoft Hazel', lang: 'en-GB' }, { name: 'Microsoft Zira', lang: 'en-US' }])!.name, /Zira/)
    assert.match(pickVoice([{ name: 'Microsoft Hazel', lang: 'en-GB' }, { name: 'Microsoft David', lang: 'en-US' }])!.name, /David/)
    assert.equal(pickVoice([{ name: 'X', lang: 'id-ID' }, { name: 'Y', lang: 'en-US' }])!.name, 'Y')
    assert.equal(pickVoice([{ name: 'X', lang: 'id-ID' }, { name: 'Hazel', lang: 'en-GB' }])!.name, 'Hazel')
  })

  test('no English voice → null', () => {
    assert.equal(pickVoice([]), null)
    assert.equal(pickVoice([{ name: 'Andika', lang: 'id-ID' }]), null)
  })
})

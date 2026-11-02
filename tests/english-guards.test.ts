import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { basisFromText } from '../src/main/sales/basis'
import { applyComparePeriod } from '../src/main/sales/pembanding'
import { hanyaBasaBasi } from '../src/main/agent/sales-guard'
import { menyinggungRiwayat } from '../src/main/riwayat/rules'
import { adaKlaimUji } from '../src/main/agent/verify-guard'
import { adaKlaimPemotongan } from '../src/main/agent/truncation-guard'
import { perluDashboardSales } from '../src/main/dashboard/rules'
import { skillOtomatisUntuk } from '../src/main/agent/skill-otomatis'
import { saranMenu } from '../src/main/agent/tool-groups'
import { tafsirkanKalimat } from '../src/shared/jadwal-pola'

// Hackathon build: users and judges write English. Every guard that reads the user's sentence gets
// English patterns (Indonesian kept), and each one is pinned on both sides — guards that delete text or
// force a tool must not fire on ordinary English (rule 26 lesson).

describe('sales basis', () => {
  test('orders received → order basis', () => {
    assert.equal(basisFromText('how many orders came in this month'), 'order')
    assert.equal(basisFromText('orders received last week'), 'order')
  })
  test('sales / revenue / invoiced → invoice basis', () => {
    assert.equal(basisFromText('what were sales this month'), 'invoice')
    assert.equal(basisFromText('how much did we invoice last month'), 'invoice')
    assert.equal(basisFromText('total revenue this year'), 'invoice')
  })
})

describe('compare period', () => {
  test('"vs last month" pins last_month', () => {
    assert.equal(applyComparePeriod('sales_compare', { period: 'this_month' }, 'sales this month vs last month').comparePeriod, 'last_month')
    assert.equal(applyComparePeriod('sales_compare', { period: 'this_week' }, 'compared to last week').comparePeriod, 'last_week')
    assert.equal(applyComparePeriod('sales_compare', { period: 'today' }, 'today versus yesterday').comparePeriod, 'yesterday')
    assert.equal(applyComparePeriod('sales_compare', { period: 'this_year' }, 'this year against the previous year').comparePeriod, 'last_year')
  })
  test('no comparison words → untouched', () => {
    assert.equal(applyComparePeriod('sales_compare', { period: 'this_month' }, 'sales this month').comparePeriod, undefined)
  })
})

describe('greeting skips the anti-hallucination guard', () => {
  test('pure greetings', () => {
    for (const s of ['hi', 'Hello!', 'who are you?', 'what can you do?', 'good morning', 'thanks']) {
      assert.equal(hanyaBasaBasi(s), true, s)
    }
  })
  test('a greeting that asks for data is not a greeting', () => {
    for (const s of ['hi, what were sales yesterday?', 'hello, how many orders this month?', 'hey, top customers last month']) {
      assert.equal(hanyaBasaBasi(s), false, s)
    }
  })
})

describe('history questions force search_history', () => {
  test('asking about an earlier conversation', () => {
    assert.equal(menyinggungRiwayat('what did I ask you yesterday?'), true)
    assert.equal(menyinggungRiwayat('what did we discuss last week?'), true)
    assert.equal(menyinggungRiwayat('what was your answer earlier about stock?'), true)
  })
  test('ordinary questions with "history" or a past date do not', () => {
    assert.equal(menyinggungRiwayat('show history of item prices'), false)
    assert.equal(menyinggungRiwayat('what were sales yesterday?'), false)
  })
})

describe('"I tested it" claim without evidence', () => {
  test('English claims are caught', () => {
    assert.equal(adaKlaimUji('I tested the code and it works.'), true)
    assert.equal(adaKlaimUji('I ran the script and all tests passed.'), true)
    assert.equal(adaKlaimUji('I have verified the function runs without errors.'), true)
  })
  test('honest or unrelated sentences stay', () => {
    assert.equal(adaKlaimUji('The patient tested positive last week.'), false)
    assert.equal(adaKlaimUji('I have not tested the code yet.'), false)
    assert.equal(adaKlaimUji('You can run the script to test it.'), false)
    assert.equal(adaKlaimUji('I tried to run the script but it failed with a connection error.'), false)
  })
})

describe('"the document was truncated" claim', () => {
  test('claims about reading are caught', () => {
    assert.equal(adaKlaimPemotongan('The document was truncated, so part of it is missing.'), true)
    assert.equal(adaKlaimPemotongan('Some pages of the file could not be read.'), true)
  })
  test('content about cutting stays', () => {
    assert.equal(adaKlaimPemotongan('The budget was truncated by 20%.'), false)
    assert.equal(adaKlaimPemotongan('Marketing spend was cut by 10% in Q3.'), false)
  })
})

describe('comparison dashboard', () => {
  test('comparison and overview questions', () => {
    assert.equal(perluDashboardSales('compare sales this month versus last month'), true)
    assert.equal(perluDashboardSales('sales this month compared to last month'), true)
    assert.equal(perluDashboardSales('give me a sales overview'), true)
    assert.equal(perluDashboardSales('how did sales grow this year'), true)
  })
  test('single numbers, lists and documents do not', () => {
    assert.equal(perluDashboardSales('what were sales yesterday'), false)
    assert.equal(perluDashboardSales('list new customers'), false)
    assert.equal(perluDashboardSales('make a PDF report comparing this month to last month'), false)
  })
})

describe('root-cause skill', () => {
  test('RCA requests', () => {
    assert.ok(skillOtomatisUntuk('do a root cause analysis of the instrument downtime'))
    assert.ok(skillOtomatisUntuk('investigate the cause of the sample mix-up yesterday'))
    assert.ok(skillOtomatisUntuk('find the cause of the reagent contamination'))
  })
  test('data and coding questions do not', () => {
    assert.equal(skillOtomatisUntuk('why did sales drop'), null)
    assert.equal(skillOtomatisUntuk('find the cause of the error in this python script'), null)
  })
})

describe('wrong-menu redirect', () => {
  test('English data questions in New Task point to the right menu', () => {
    assert.equal(saranMenu('what were sales last month?', 'general'), 'sales')
    assert.equal(saranMenu('who are our top customers?', 'general'), 'sales')
    assert.equal(saranMenu('what is the list price of the HbA1c test?', 'general'), 'masterdata')
    assert.equal(saranMenu('which samples are still pending results?', 'general'), 'lab')
  })
  test('non-data requests stay', () => {
    assert.equal(saranMenu('write a python script that renames files', 'general'), null)
    assert.equal(saranMenu('summarize this document', 'general'), null)
  })
})

describe('schedule sentence', () => {
  const now = new Date(2026, 10, 2, 9, 0)
  test('"every Monday at 8" → weekly Monday 08:00', () => {
    assert.deepEqual(tafsirkanKalimat('every Monday at 8 summarize last week sales', now).pola, { jenis: 'mingguan', hari: [1], jam: '08:00' })
  })
  test('daily, weekdays and monthly', () => {
    assert.deepEqual(tafsirkanKalimat('every day at 7:30 check the sample backlog', now).pola, { jenis: 'harian', jam: '07:30' })
    assert.deepEqual(tafsirkanKalimat('every weekday at 9 send me the TAT summary', now).pola, { jenis: 'hari_kerja', jam: '09:00' })
    assert.deepEqual(tafsirkanKalimat('remind me on the 1st of every month at 8 to send the sales report', now).pola, { jenis: 'bulanan', tanggal: 1, jam: '08:00' })
  })
  test('"remind me" is a reminder', () => {
    assert.equal(tafsirkanKalimat('remind me every Friday at 4 pm to check stock', now).jenis, 'pengingat')
    assert.deepEqual(tafsirkanKalimat('remind me every Friday at 4 pm to check stock', now).pola, { jenis: 'mingguan', hari: [5], jam: '16:00' })
  })
  test('"last week" is not a day', () => {
    assert.equal(tafsirkanKalimat('summarize last week sales', now).pola, null)
  })
})

describe('system prompt', () => {
  test('answers in English and uses the de-branded names', () => {
    const s = readFileSync('src/main/agent/orchestrator.ts', 'utf8')
    assert.ok(s.includes('Always answer in English.'))
    const prompts = s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    for (const banned of ['Order ID', 'ERP', 'Master Data', 'the company', 'the lab']) {
      assert.ok(!prompts.includes(banned), banned)
    }
  })
})

describe('questions about AIRA itself use the Guide', () => {
  test('English capability and how-to questions', async () => {
    const { menyinggungPanduan } = await import('../src/main/agent/panduan-guard')
    // "can you make a ppt?" was replaced (final review): the generic "can you …?" form forced the Guide on
    // ordinary requests and was removed.
    for (const s of ['what can you do?', 'what can you do with presentations?', 'how do I use the schedule?', 'who are you?', 'is there a user guide?']) {
      assert.equal(menyinggungPanduan(s), true, s)
    }
  })
  test('real work, or a question about an attached file, does not', async () => {
    const { menyinggungPanduan } = await import('../src/main/agent/panduan-guard')
    for (const s of [
      'what can you do with this?\n\n[Attached file: report.xlsx → D:/files/report.xlsx]',
      'how do I compare sales this month to last month?',
      'can you summarize the attached document?'
    ]) {
      assert.equal(menyinggungPanduan(s), false, s)
    }
  })
})

// ---------------------------------------------------------------------------
// Final code review fixes (2 Nov 2026). Each block pins the exact sentences from the review.
// ---------------------------------------------------------------------------

describe('review #1: "test" alone is small talk again', () => {
  test('"test" / "tes" count as small talk; "tests" still asks for data', () => {
    assert.equal(hanyaBasaBasi('test'), true)
    assert.equal(hanyaBasaBasi('tes'), true)
    assert.equal(hanyaBasaBasi('hi, how many tests this month?'), false)
  })
})

describe('review #2: English "I tested it" claim is tied to a test verb + result', () => {
  test('real claims stay caught', () => {
    assert.equal(adaKlaimUji('I tested the code and it works.'), true)
    assert.equal(adaKlaimUji('I ran the script and all tests passed.'), true)
    assert.equal(adaKlaimUji('I have verified the function runs without errors.'), true)
  })
  test('true sentences are not deleted', () => {
    for (const s of [
      'I have created a test file for the function.',
      'The script has a test block at the bottom.',
      'The function has runtime complexity O(n).',
      "I've added validation to the code so bad input is rejected.",
      'We have a build step in the script.',
      'I ran into a limitation: the file API cannot read .xlsb.',
      'Run the script and it works on any folder.'
    ]) {
      assert.equal(adaKlaimUji(s), false, s)
    }
  })
  test('the replacement note shown to users is English', async () => {
    const { CATATAN_BELUM_DIUJI } = await import('../src/main/agent/verify-guard')
    assert.match(CATATAN_BELUM_DIUJI, /has not been run in the test sandbox/i)
    assert.match(CATATAN_BELUM_DIUJI, /test it first/i)
    assert.doesNotMatch(CATATAN_BELUM_DIUJI, /belum dijalankan/i)
  })
})

describe('review #3: "order" as a sorting word does not switch to order basis', () => {
  test('sorting phrases → invoice', () => {
    assert.equal(basisFromText('top 10 customers by sales in descending order'), 'invoice')
    assert.equal(basisFromText('list items ordered by revenue'), 'invoice')
    assert.equal(basisFromText('sales by region, in order of growth'), 'invoice')
    assert.equal(basisFromText('how much revenue came in last month'), 'invoice')
  })
  test('real order questions stay order', () => {
    assert.equal(basisFromText('how many orders came in this month'), 'order')
    assert.equal(basisFromText('orders received last week'), 'order')
    assert.equal(basisFromText('sales order ERP bulan ini'), 'order')
    assert.equal(basisFromText('sales order by branch this month'), 'order')
    assert.equal(basisFromText('berapa order yang masuk bulan ini'), 'order')
  })
})

describe('review #4: English negation in ERP scope', () => {
  test('"not yet in" / "missing from" → not_erp', async () => {
    const { scopeFromText } = await import('../src/main/sales/erp')
    assert.equal(scopeFromText('sales not yet in the ERP'), 'not_erp')
    assert.equal(scopeFromText('orders missing from the ERP'), 'not_erp')
    assert.equal(scopeFromText("invoices that haven't been sent to the ERP"), 'not_erp')
    assert.equal(scopeFromText('orders that have not been bridged to the ERP'), 'not_erp')
  })
  test('"in the ERP" → erp; Indonesian unchanged', async () => {
    const { scopeFromText } = await import('../src/main/sales/erp')
    assert.equal(scopeFromText('sales in the ERP'), 'erp')
    assert.equal(scopeFromText('order yang belum masuk erp'), 'not_erp')
    assert.equal(scopeFromText('data sales yang masuk ERP bulan lalu'), 'erp')
  })
})

describe('review #5: Order ID / Order ID status questions stay in the sales menu', () => {
  test('sales mode: ERP / invoiced / Order ID status → no redirect', () => {
    assert.equal(saranMenu('is Order ID 2608190049 in the ERP yet?', 'sales'), null)
    assert.equal(saranMenu('has Order ID 2608190049 been invoiced?', 'sales'), null)
    assert.equal(saranMenu('Order ID 2608190049 sudah masuk belum?', 'sales'), null)
  })
  test('real lab questions still go to the lab menu', () => {
    assert.equal(saranMenu('which samples are still pending results?', 'general'), 'lab')
    assert.equal(saranMenu('which stage is Order ID 123 at?', 'sales'), 'lab')
  })
  test('"ERP" alone in New Task is not a sales question', () => {
    assert.equal(saranMenu('write an email about our ERP migration', 'general'), null)
  })
})

describe('review #6: English region words steer to the master-data dimension', () => {
  test('"which city" is steered like "kota mana"', async () => {
    const { steerRegionDimension } = await import('../src/main/sales/region')
    const id = steerRegionDimension('sales_breakdown', { dimension: 'city' }, 'kota mana yang sales tertinggi?')
    const en = steerRegionDimension('sales_breakdown', { dimension: 'city' }, 'which city has the highest sales?')
    assert.equal(id.dimension, 'city_customer')
    assert.equal(en.dimension, id.dimension)
    assert.equal(
      steerRegionDimension('sales_breakdown', { dimension: 'city' }, 'which province has the highest sales?').dimension,
      'province'
    )
  })
})

describe('review #7: the Guide guard is narrow', () => {
  test('questions about AIRA itself', async () => {
    const { menyinggungPanduan } = await import('../src/main/agent/panduan-guard')
    for (const s of ['what can you do?', 'how do I use the schedule?', 'who are you?', 'is there a user guide?', 'what can you do with presentations?']) {
      assert.equal(menyinggungPanduan(s), true, s)
    }
  })
  test('ordinary requests are not Guide questions', async () => {
    const { menyinggungPanduan } = await import('../src/main/agent/panduan-guard')
    for (const s of [
      'Can you explain what an API is?',
      'Can you write a python script to rename files?',
      'can you help me write an email?',
      'Write a style guide for our emails'
    ]) {
      assert.equal(menyinggungPanduan(s), false, s)
    }
  })
})

describe('review #8: history guard needs a first/second-person conversation', () => {
  test('questions about an earlier conversation', () => {
    assert.equal(menyinggungRiwayat('what did I ask you yesterday?'), true)
    assert.equal(menyinggungRiwayat('what did we discuss last week?'), true)
    assert.equal(menyinggungRiwayat('what was your answer earlier about stock?'), true)
    assert.equal(menyinggungRiwayat('kemarin saya tanya apa?'), true)
  })
  test('ordinary sentences with "ago", "before", "said" or "answered" do not', () => {
    for (const s of [
      'Before you answer, read the attached file.',
      'The customer said the samples arrived late two days ago, write an apology email',
      'Write a function that shows how long ago a message was answered',
      'show history of item prices',
      'what were sales yesterday?'
    ]) {
      assert.equal(menyinggungRiwayat(s), false, s)
    }
  })
})

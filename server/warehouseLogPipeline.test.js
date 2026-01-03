import assert from 'node:assert/strict'
import test from 'node:test'

test('parses Slack checklist bullets into full item list', async () => {
  const originalEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_API_TOKEN: process.env.OPENAI_API_TOKEN,
    OPENAI_KEY: process.env.OPENAI_KEY,
  }

  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn
  console.error = () => {}
  console.warn = () => {}

  try {
    process.env.OPENAI_API_KEY = ''
    process.env.OPENAI_API_TOKEN = ''
    process.env.OPENAI_KEY = ''

    const { processWarehouseLogMessage } = await import('./warehouseLogPipeline.js')

    const text = [
      'Earlier today from 1440 Kostner Aldi:',
      '• [ ] 1 case frozen steak (32.5 lbs)',
      '• [ ] ~1.5 dozen packages frozen chicken',
      '• [ ] ~ 2 dozen assorted frozen bread',
      '• [ ] ~ 1 dozen frozen pizza',
      '• [ ] 1 box misc drinks',
      '• [ ] 3 boxes misc snacks (crackers, mini, cereal, fruit cups)',
      '• [ ] 8 cases water',
      '• [ ] ~3 dozen bottles Gatorade',
    ].join(' ')

    const result = await processWarehouseLogMessage({
      event: { text, ts: '123.456', channel: 'C_TEST', user: 'U_TEST' },
      supabase: null,
      slackBotToken: null,
      slackPostingDisabled: true,
    })

    const names = (result.parsedItems || []).map((item) => item.name)
    assert.equal(names.length, 8)
    assert.deepEqual(
      new Set(names),
      new Set([
        'frozen steak',
        'frozen chicken',
        'assorted frozen bread',
        'frozen pizza',
        'misc drinks',
        'misc snacks',
        'water',
        'Gatorade',
      ]),
    )
    assert.equal(result.payload.location, '1440 Kostner Aldi')
  } finally {
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
    process.env.OPENAI_API_TOKEN = originalEnv.OPENAI_API_TOKEN
    process.env.OPENAI_KEY = originalEnv.OPENAI_KEY
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
  }
})

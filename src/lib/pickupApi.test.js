import assert from 'node:assert/strict'
import test from 'node:test'
import { createEvent, signupForEvent, submitPickupSignup, updateAccountRole, updateSignupStatus } from './pickupApi.js'
import { PERMISSIONS, ROLES, ensurePermission, hasPermission } from './permissions.js'

const createMockSupabase = ({ pendingRows = [], updateRow = {} } = {}) => {
  const inserts = []
  const updates = []
  const selections = []

  const client = {
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload })
          return Promise.resolve({ data: [{ id: `${table}-row`, ...payload }], error: null })
        },
        select() {
          return {
            eq(column, value) {
              selections.push({ table, column, value })
              return {
                order(orderColumn, options) {
                  selections.push({ table, orderColumn, options })
                  return Promise.resolve({ data: pendingRows, error: null })
                },
              }
            },
          }
        },
        update(payload) {
          return {
            eq(column, value) {
              updates.push({ table, payload, column, value })
              return {
                select() {
                  const data = [{ id: value, ...updateRow, ...payload }]
                  return Promise.resolve({ data, error: null })
                },
              }
            },
          }
        },
      }
    },
  }

  return { client, inserts, updates, selections }
}

const createEmailStub = () => {
  const calls = []
  const stub = async (payload) => {
    calls.push(payload)
    return { data: { ok: true }, error: null }
  }
  return { stub, calls }
}

const createSlackStub = () => {
  const calls = []
  const stub = async (payload) => {
    calls.push(payload)
    return { data: { ok: true }, error: null }
  }
  return { stub, calls }
}

test('signs up for an existing pickup event and queues review by default', async () => {
  const mockSupabase = createMockSupabase()
  const signup = {
    slot_key: 'kroger-wed',
    store: 'Kroger',
    day: 'Wednesday',
    time: '5:00 PM',
    volunteer_name: 'Ava Volunteer',
    volunteer_email: 'ava@example.com',
  }

  const response = await submitPickupSignup(signup, { supabaseClient: mockSupabase.client })

  assert.equal(mockSupabase.inserts.length, 1)
  assert.equal(mockSupabase.inserts[0].table, 'pickup_signups')
  assert.equal(mockSupabase.inserts[0].payload.status, 'pending')
  assert.equal(response.error, null)
  assert.equal(response.autoApproved, false)
})

test('signup works without an account and still goes to review', async () => {
  const mockSupabase = createMockSupabase()
  const signup = {
    slot_key: 'farmers-sat',
    store: 'Farmers Market',
    day: 'Saturday',
    time: '10:00 AM',
    volunteer_name: 'Sam',
    volunteer_email: 'sam@example.com',
  }

  const response = await signupForEvent({
    event: { id: 'farmers', tags: ['fresh-produce'] },
    signup,
    supabaseClient: mockSupabase.client,
  })

  assert.equal(mockSupabase.inserts.length, 1)
  assert.equal(mockSupabase.inserts[0].payload.status, 'pending')
  assert.equal(response.error, null)
})

test('greenlit accounts with matching tags bypass review and auto approve', async () => {
  const mockSupabase = createMockSupabase()
  const emailStub = createEmailStub()

  const response = await signupForEvent({
    event: { id: 'target', tags: ['driver', 'evening'], name: 'Target Pickup', day: 'Monday', time: '7:00 PM' },
    signup: {
      slot_key: 'target-monday',
      store: 'Target',
      day: 'Monday',
      time: '7:00 PM',
      volunteer_name: 'Jordan',
      volunteer_email: 'jordan@example.com',
    },
    account: { status: 'greenlit', tags: ['driver', 'evening', 'late-shift'] },
    supabaseClient: mockSupabase.client,
    emailClient: emailStub.stub,
  })

  assert.equal(mockSupabase.inserts[0].payload.status, 'approved')
  assert.ok(mockSupabase.inserts[0].payload.reviewed_at)
  assert.equal(response.autoApproved, true)
  assert.equal(emailStub.calls.length, 1)
})

test('reviewer can approve signups but cannot create events', async () => {
  const mockSupabase = createMockSupabase({
    updateRow: {
      volunteer_email: 'reviewer@example.com',
      store: 'TJ',
      day: 'Thursday',
      time: '6:30 PM',
    },
  })
  const emailStub = createEmailStub()
  const reviewer = { role: ROLES.REVIEWER }

  const approveResponse = await updateSignupStatus('id-1', 'approved', {
    supabaseClient: mockSupabase.client,
    emailClient: emailStub.stub,
    actor: reviewer,
  })

  const createResponse = await createEvent(
    { name: 'Cannot do this' },
    { supabaseClient: mockSupabase.client, actor: reviewer },
  )

  assert.equal(approveResponse.error, null)
  assert.equal(createResponse.data, null)
  assert.ok(createResponse.error)
  assert.equal(emailStub.calls.length, 1)
})

test('admin can update other account roles', async () => {
  const mockSupabase = createMockSupabase()
  const admin = { role: ROLES.ADMIN }

  const response = await updateAccountRole('acct-1', ROLES.REVIEWER, {
    supabaseClient: mockSupabase.client,
    actor: admin,
    tableName: 'pickup_accounts',
  })

  assert.equal(response.error, null)
  assert.equal(mockSupabase.updates.length, 1)
  assert.equal(mockSupabase.updates[0].payload.role, ROLES.REVIEWER)
})

test('permission helpers map roles to capabilities', () => {
  const admin = { role: ROLES.ADMIN }
  const reviewer = { role: ROLES.REVIEWER }

  assert.equal(hasPermission(admin, PERMISSIONS.MANAGE_PERMISSIONS), true)
  assert.equal(hasPermission(reviewer, PERMISSIONS.MANAGE_PERMISSIONS), false)

  const allowReview = ensurePermission(reviewer, PERMISSIONS.REVIEW_SIGNUPS)
  const denyManage = ensurePermission(reviewer, PERMISSIONS.MANAGE_PERMISSIONS)

  assert.equal(allowReview.ok, true)
  assert.equal(denyManage.ok, false)
})

test('greenlit accounts without matching tags still go to review queue', async () => {
  const mockSupabase = createMockSupabase()

  const response = await signupForEvent({
    event: { id: 'fresh-market', tags: ['cold-storage'] },
    signup: {
      slot_key: 'fresh-market',
      store: 'Fresh Market',
      volunteer_name: 'Taylor',
      volunteer_email: 'taylor@example.com',
    },
    account: { status: 'greenlit', tags: ['driver'] },
    supabaseClient: mockSupabase.client,
  })

  assert.equal(mockSupabase.inserts[0].payload.status, 'pending')
  assert.equal(response.autoApproved, false)
})

test('creates a new event and notifies Slack scaffolding', async () => {
  const mockSupabase = createMockSupabase()
  const slackStub = createSlackStub()

  const response = await createEvent(
    { name: 'Community Center Dropoff', day: 'Friday', tags: ['dropoff'] },
    { supabaseClient: mockSupabase.client, slackClient: slackStub.stub },
  )

  assert.equal(mockSupabase.inserts.length, 1)
  assert.equal(mockSupabase.inserts[0].table, 'pickup_events')
  assert.equal(mockSupabase.inserts[0].payload.status, 'pending_review')
  assert.equal(response.error, null)
  assert.equal(slackStub.calls.length, 1)
  assert.ok(slackStub.calls[0].text.includes('Community Center Dropoff'))
})

test('approving a signup updates status and sends a confirmation email', async () => {
  const mockSupabase = createMockSupabase({
    updateRow: {
      volunteer_email: 'lee@example.com',
      store: 'Safeway',
      day: 'Friday',
      time: '5:00 PM',
    },
  })
  const emailStub = createEmailStub()

  const response = await updateSignupStatus('signup-123', 'approved', {
    supabaseClient: mockSupabase.client,
    emailClient: emailStub.stub,
  })

  assert.equal(mockSupabase.updates.length, 1)
  assert.equal(mockSupabase.updates[0].table, 'pickup_signups')
  assert.equal(mockSupabase.updates[0].payload.status, 'approved')
  assert.equal(response.error, null)
  assert.equal(emailStub.calls.length, 1)
  assert.equal(emailStub.calls[0].to, 'lee@example.com')
})

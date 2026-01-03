const PERMISSIONS = {
  REVIEW_SIGNUPS: 'review:signups',
  MANAGE_PERMISSIONS: 'manage:permissions',
  CREATE_EVENTS: 'events:create',
}

const ROLES = {
  ADMIN: 'admin',
  REVIEWER: 'reviewer',
}

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: [
    PERMISSIONS.REVIEW_SIGNUPS,
    PERMISSIONS.MANAGE_PERMISSIONS,
    PERMISSIONS.CREATE_EVENTS,
  ],
  [ROLES.REVIEWER]: [
    PERMISSIONS.REVIEW_SIGNUPS,
  ],
}

const hasPermission = (actor, permission) => {
  if (!actor || !actor.role) return false
  const allowed = ROLE_PERMISSIONS[actor.role] || []
  return allowed.includes(permission)
}

const ensurePermission = (actor, permission) => {
  const ok = hasPermission(actor, permission)
  return ok
    ? { ok: true, error: null }
    : { ok: false, error: new Error('Permission denied for requested action.') }
}

export {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
  ensurePermission,
}

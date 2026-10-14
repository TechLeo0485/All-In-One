/**
 * Proton addresses, shared by main and renderer. One Proton mailbox answers to
 * several addresses: "name@proton.me", "name@pm.me", "name@protonmail.com" and
 * "name+anything@…" all reach the same user, and the login accepts just "name".
 */

const PROTON_DOMAINS = ['proton.me', 'pm.me', 'protonmail.com', 'protonmail.ch']

export const MAX_EMAIL_LENGTH = 254

/** What the user typed (address or bare username) as an address; '' stays ''. */
export function normalizeProtonEmail(input: string): string {
  const value = input.trim().toLowerCase()
  if (!value) return ''
  return value.includes('@') ? value : `${value}@proton.me`
}

/** A comparable form: Proton addresses lose their "+tag" and domain. */
function mailboxKey(email: string): string {
  const value = email.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at < 0) return value
  const domain = value.slice(at + 1)
  return PROTON_DOMAINS.includes(domain) ? `${value.slice(0, at).split('+')[0]}@proton` : value
}

/** Whether two addresses reach the same mailbox. */
export function sameMailbox(a: string, b: string): boolean {
  return Boolean(a && b) && mailboxKey(a) === mailboxKey(b)
}

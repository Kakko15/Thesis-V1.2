const target = process.argv[2]
if (!target) {
  console.error('Usage: npm run security:headers -- https://your-deployment.example')
  process.exit(2)
}

const url = new URL(target)
const response = await fetch(url, { redirect: 'follow' })
const required = {
  'content-security-policy': /default-src\s+'self'.*frame-ancestors\s+'none'/i,
  'x-frame-options': /^DENY$/i,
  'x-content-type-options': /^nosniff$/i,
  'referrer-policy': /strict-origin-when-cross-origin/i,
  'permissions-policy': /camera=\(\).*microphone=\(\)/i,
}
if (url.protocol === 'https:') required['strict-transport-security'] = /max-age=\d+/i

const failures = Object.entries(required).flatMap(([name, pattern]) => {
  const value = response.headers.get(name) || ''
  return pattern.test(value) ? [] : [`${name}: missing or invalid`]
})
if (!response.ok) failures.push(`deployment returned HTTP ${response.status}`)
if (failures.length) {
  console.error(`Security header validation failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(`Required production security headers are present on ${response.url}`)


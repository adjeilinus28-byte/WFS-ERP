// GET /.netlify/functions/org-logo?org=<uuid>
// Serves a workspace's logo as a normal image so emails can show it (email apps
// block the embedded data: images the logo is stored as). Logos are public
// branding, so no sign-in is needed; only the image itself is returned.
const { admin } = require('./_lib')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATA_URI = /^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/

exports.handler = async (event) => {
  const org = (event.queryStringParameters || {}).org || ''
  if (!UUID.test(org)) return { statusCode: 400, body: 'Bad request' }
  try {
    const { data } = await admin().from('organizations').select('logo_url').eq('id', org).maybeSingle()
    const logo = data?.logo_url || ''
    if (/^https:\/\//i.test(logo)) {
      return { statusCode: 302, headers: { Location: logo, 'Cache-Control': 'public, max-age=3600' }, body: '' }
    }
    const m = logo.match(DATA_URI)
    if (!m) return { statusCode: 404, headers: { 'Cache-Control': 'public, max-age=300' }, body: 'No logo' }
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': m[1],
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        // An SVG opened directly must not run scripts on this site.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
      body: m[2].replace(/\s/g, ''),
    }
  } catch (e) {
    console.error('[org-logo]', e)
    return { statusCode: 500, body: 'Error' }
  }
}

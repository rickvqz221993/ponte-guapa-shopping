// Ponte Guapa Shopping — lazy Stripe client per CONTRACT §2.
// getClient() returns null when STRIPE_SECRET_KEY is not set.
// stripe is required lazily inside the function so a missing/misconfigured
// key can never crash the boot.
let client = null;
let attempted = false;

function getClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!attempted) {
    attempted = true;
    try {
      client = require('stripe')(process.env.STRIPE_SECRET_KEY);
    } catch (e) {
      console.warn('[stripe] init failed:', e.message);
      client = null;
    }
  }
  return client;
}

function getPublishable() {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}

module.exports = { getClient, getPublishable };

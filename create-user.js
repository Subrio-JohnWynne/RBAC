#!/usr/bin/env node
const SUPABASE_URL = 'https://xwhkivqhnkvdjdamojha.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('Error: Set SUPABASE_SERVICE_ROLE_KEY in your environment.');
  process.exit(1);
}

const [,, email, password, fullName = '', role = 'viewer'] = process.argv;

if (!email || !password) {
  console.error('Usage: node create-user.js <email> <password> [fullName] [role]');
  process.exit(1);
}

const payload = {
  email,
  password,
  email_confirm: true,
  user_metadata: {
    full_name: fullName,
    role
  }
};

async function run() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json();
  if (!res.ok) {
    console.error('Failed to create user:', body);
    process.exit(1);
  }

  console.log('User created successfully:');
  console.log(JSON.stringify(body, null, 2));
}

run().catch(err => {
  console.error('Unexpected error:', err.message || err);
  process.exit(1);
});

// ══════════════════════════════════════════════
//   SUPABASE INIT
// ══════════════════════════════════════════════
const SUPABASE_URL = 'https://xwhkivqhnkvdjdamojha.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aGtpdnFobmt2ZGpkYW1vamhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0OTgyNTAsImV4cCI6MjA5NDA3NDI1MH0.BiPVJaZDeypOtTAARKRew96zOyxqk8Ib0np4zjggjb0';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storage: window.localStorage
  }
});

// ══════════════════════════════════════════════
//   GLOBAL STATE
// ══════════════════════════════════════════════
let currentUser = null;
let currentProfile = null;
let modalTargetUser = null;

// ══════════════════════════════════════════════
//   INIT — check session on load
// ══════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  // Listen for auth state changes (handles refresh + existing sessions)
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await loadProfile();
      showDashboard();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      showAuthScreen();
    } else if (event === 'TOKEN_REFRESHED' && session) {
      currentUser = session.user;
    }
  });

  // Also check for existing session immediately
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadProfile();
    showDashboard();
  }
});

// ══════════════════════════════════════════════
//   AUTH — LOGIN
// ══════════════════════════════════════════════
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');

  hideError('login-error');

  if (!email || !password) {
    showError('login-error', 'Please enter both email and password.');
    return;
  }

  setLoading('form-login', true);

  const { data, error } = await db.auth.signInWithPassword({ email, password });

  setLoading('form-login', false);

  if (error) {
    let msg = error.message;
    if (msg.includes('Invalid login credentials')) msg = 'Invalid email or password.';
    if (msg.includes('Email not confirmed')) msg = 'Please confirm your email before logging in.';
    showError('login-error', msg);
    return;
  }

  // onAuthStateChange will handle the rest
}

// ══════════════════════════════════════════════
//   AUTH — REGISTER
// ══════════════════════════════════════════════
async function handleRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const role     = document.getElementById('reg-role').value;

  hideError('reg-error');
  hideSuccess('reg-success');

  if (!name || !email || !password) {
    showError('reg-error', 'All fields are required.');
    return;
  }
  if (password.length < 6) {
    showError('reg-error', 'Password must be at least 6 characters.');
    return;
  }

  setLoading('form-register', true);

  // Sign up user. This uses Supabase email signup and can still trigger confirmation emails.
  // If your project has email rate limits, use a service-role admin user creation flow instead.
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name, role }
    }
  });

  setLoading('form-register', false);

  if (error) {
    let msg = error.message;
    if (error.status === 99999999999 || msg.toLowerCase().includes('rate limit')) {
      msg = 'Too many account creation attempts. Please wait a few minutes.';
    }
    showError('reg-error', msg);
    return;
  }

  // If Supabase email confirmation is disabled, user is logged in immediately
  if (data.session) {
    currentUser = data.user;
    // Profile is created by DB trigger or we create it manually
    await upsertProfile(data.user.id, name, role);
    await loadProfile();
    showDashboard();
    return;
  }

  // If email confirmation is required
  if (data.user && !data.session) {
    showSuccess('reg-success', '✓ Account created! Check your email to confirm, then log in.');
    clearRegisterForm();
    return;
  }
}


async function loadProfile() {
  if (!currentUser) return;

  // Try fetching from profiles table
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (error || !data) {
    
    const meta = currentUser.user_metadata || {};
    currentProfile = {
      id: currentUser.id,
      full_name: meta.full_name || currentUser.email.split('@')[0],
      role: meta.role || 'viewer',
      email: currentUser.email
    };
    
    await upsertProfile(currentProfile.id, currentProfile.full_name, currentProfile.role);
  } else {
    currentProfile = data;
    currentProfile.email = currentUser.email;
  }
}

async function upsertProfile(id, fullName, role) {
  await db.from('profiles').upsert({
    id,
    full_name: fullName,
    role,
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' });
}

async function handleLogout() {
  await logAction('LOGOUT', 'User logged out');
  await db.auth.signOut();
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('auth-screen').classList.add('active');
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('active');
}

async function showDashboard() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('active');

  renderUserInfo();
  applyRolePermissions();
  loadDashboardStats();
  showPanel('dashboard');
  await logAction('LOGIN', 'User logged in');
}


function renderUserInfo() {
  if (!currentProfile) return;
  const { full_name, role } = currentProfile;
  const initial = full_name ? full_name[0].toUpperCase() : 'U';

  document.getElementById('sidebar-avatar').textContent = initial;
  document.getElementById('sidebar-name').textContent = full_name || 'User';

  const roleEl = document.getElementById('sidebar-role');
  roleEl.textContent = role.toUpperCase();
  roleEl.className = `role-badge ${role}`;

  document.getElementById('stat-role').textContent = role.toUpperCase();
}

function applyRolePermissions() {
  const role = currentProfile?.role || 'viewer';

  
  const adminOnly = ['nav-users', 'nav-logs'];
  adminOnly.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (role !== 'admin') {
        el.classList.add('disabled');
      } else {
        el.classList.remove('disabled');
      }
    }
  });

  // Show "Add Content" button for editor and admin
  const addBtn = document.getElementById('btn-add-content');
  if (addBtn) addBtn.style.display = (role === 'editor' || role === 'admin') ? '' : 'none';
}


function showPanel(name) {
  const role = currentProfile?.role || 'viewer';

  // Access control
  if ((name === 'users' || name === 'logs') && role !== 'admin') {
    alert('Access Denied: This section requires ADMIN privileges.');
    return;
  }

  // Hide all panels
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show target panel
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add('active');

  // Highlight nav
  const navMap = {
    dashboard: 0, users: 1, content: 2, logs: 3
  };
  const navItems = document.querySelectorAll('.nav-item');
  if (navItems[navMap[name]]) navItems[navMap[name]].classList.add('active');

  // Load panel data
  if (name === 'users')   loadUsers();
  if (name === 'content') loadContent();
  if (name === 'logs')    loadLogs();
}

async function loadDashboardStats() {
  
  const { data: users } = await db.from('profiles').select('id');
  document.getElementById('stat-users').textContent = users?.length ?? '—';

  const { data: logs } = await db.from('activity_logs').select('id');
  document.getElementById('stat-logs').textContent = logs?.length ?? '—';
}


async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading-row">Loading...</td></tr>';

  const { data, error } = await db.from('profiles').select('*').order('created_at', { ascending: false });

  if (error || !data) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-row">Error: ${error?.message}</td></tr>`;
    return;
  }

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-row">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(user => `
    <tr>
      <td>${esc(user.full_name || '—')}</td>
      <td>${esc(user.id)}</td>
      <td><span class="pill ${user.role}">${(user.role || 'viewer').toUpperCase()}</span></td>
      <td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td>
      <td>
        ${user.id !== currentUser.id
          ? `<button class="btn-small" onclick="openRoleModal('${esc(user.id)}','${esc(user.full_name || '')}','${user.role}')">CHANGE ROLE</button>`
          : '<span style="color:var(--text-dim);font-size:11px;">YOU</span>'
        }
      </td>
    </tr>
  `).join('');
}

function openRoleModal(userId, userName, currentRole) {
  modalTargetUser = userId;
  document.getElementById('modal-user-name').textContent = userName;
  document.getElementById('modal-role-select').value = currentRole;
  document.getElementById('role-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('role-modal').classList.add('hidden');
  modalTargetUser = null;
}

async function confirmRoleChange() {
  if (!modalTargetUser) return;
  const newRole = document.getElementById('modal-role-select').value;

  const { error } = await db.from('profiles')
    .update({ role: newRole })
    .eq('id', modalTargetUser);

  if (!error) {
    await logAction('ROLE_CHANGE', `Changed user ${modalTargetUser} to role: ${newRole}`);
    closeModal();
    loadUsers();
  } else {
    alert('Error updating role: ' + error.message);
  }
}


async function loadContent() {
  const tbody = document.getElementById('content-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading-row">Loading...</td></tr>';

  const { data, error } = await db.from('content').select('*').order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-row">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-row">No content yet.</td></tr>';
    return;
  }

  const role = currentProfile?.role || 'viewer';

  tbody.innerHTML = data.map(item => `
    <tr>
      <td><strong>${esc(item.title)}</strong></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.body || '')}</td>
      <td>${esc(item.created_by_name || '—')}</td>
      <td>${item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</td>
      <td>
        ${(role === 'editor' || role === 'admin')
          ? `<button class="btn-small" onclick="deleteContent('${item.id}')">DELETE</button>`
          : '<span style="color:var(--text-dim);font-size:11px;">READ ONLY</span>'
        }
      </td>
    </tr>
  `).join('');
}

function showAddContent() {
  document.getElementById('add-content-form').classList.remove('hidden');
}
function hideAddContent() {
  document.getElementById('add-content-form').classList.add('hidden');
  document.getElementById('content-title').value = '';
  document.getElementById('content-body').value = '';
}

async function addContent() {
  const title = document.getElementById('content-title').value.trim();
  const body = document.getElementById('content-body').value.trim();
  if (!title) { alert('Title is required.'); return; }

  const { error } = await db.from('content').insert({
    title,
    body,
    created_by: currentUser.id,
    created_by_name: currentProfile?.full_name || 'Unknown'
  });

  if (error) { alert('Error: ' + error.message); return; }

  await logAction('CONTENT_ADD', `Added content: "${title}"`);
  hideAddContent();
  loadContent();
}

async function deleteContent(id) {
  if (!confirm('Delete this record?')) return;
  const { error } = await db.from('content').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await logAction('CONTENT_DELETE', `Deleted content ID: ${id}`);
  loadContent();
}

// ══════════════════════════════════════════════
//   ACTIVITY LOGS (ADMIN)
// ══════════════════════════════════════════════
async function loadLogs() {
  const tbody = document.getElementById('logs-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="loading-row">Loading...</td></tr>';

  const { data, error } = await db
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="loading-row">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-row">No logs yet.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(log => `
    <tr>
      <td style="white-space:nowrap;font-size:12px">${new Date(log.created_at).toLocaleString()}</td>
      <td>${esc(log.user_name || log.user_id || '—')}</td>
      <td><span class="pill viewer">${esc(log.action)}</span></td>
      <td style="color:var(--text-dim);font-size:12px">${esc(log.details || '')}</td>
    </tr>
  `).join('');
}

async function logAction(action, details) {
  if (!currentUser) return;
  await db.from('activity_logs').insert({
    user_id: currentUser.id,
    user_name: currentProfile?.full_name || currentUser.email,
    action,
    details
  });
}

// ══════════════════════════════════════════════
//   UI HELPERS
// ══════════════════════════════════════════════
function switchTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  hideError('login-error');
  hideError('reg-error');
  hideSuccess('reg-success');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.add('show'); }
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}

function showSuccess(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.add('show'); }
}

function hideSuccess(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}

function setLoading(formId, loading) {
  const form = document.getElementById(formId);
  if (!form) return;
  const btn = form.querySelector('.btn-primary');
  const text = form.querySelector('.btn-text');
  const loader = form.querySelector('.btn-loader');
  if (btn) btn.disabled = loading;
  if (text) text.classList.toggle('hidden', loading);
  if (loader) loader.classList.toggle('hidden', !loading);
}

function clearRegisterForm() {
  ['reg-name', 'reg-email', 'reg-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  const modal = document.getElementById('role-modal');
  if (e.target === modal) closeModal();
});

// Enter key to submit login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const loginForm = document.getElementById('form-login');
    if (loginForm && !loginForm.classList.contains('hidden')) handleLogin();
  }
});
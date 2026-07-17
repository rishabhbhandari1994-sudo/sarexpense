// app.js - TrailCash Main Application Logic

const CATEGORIES = [
  { name: 'Ration', emoji: '🌾' },
  { name: 'Fuel / Diesel', emoji: '⛽' },
  { name: 'Transportation', emoji: '🚌' },
  { name: 'Mule', emoji: '🐴' },
  { name: 'Porter', emoji: '🎒' },
  { name: 'Guide', emoji: '🗺️' },
  { name: 'Hotel', emoji: '🏨' },
  { name: 'Homestay', emoji: '🏡' },
  { name: 'Food', emoji: '🍔' },
  { name: 'Medical', emoji: '💊' },
  { name: 'Equipment', emoji: '🛠️' },
  { name: 'Forest Permit', emoji: '🌲' },
  { name: 'Entry Fee', emoji: '🎟️' },
  { name: 'Miscellaneous', emoji: '📦' },
  { name: 'Other', emoji: '❓' }
];

const COMPANY_EXPENSE_CATEGORIES = [
  'Office Rent',
  'Salary',
  'Marketing',
  'Fuel',
  'Software',
  'Internet',
  'Electricity',
  'Travel',
  'Miscellaneous'
];

// Supabase primary keys are UUIDs. Keep generated client records compatible
// with Postgres instead of using legacy `expense-123` style identifiers.
const newRecordId = () => crypto.randomUUID();

const app = {
  // Global State
  currentUser: null, // Logged in profile name
  currentLanguage: 'en', // 'en' or 'hi'
  activeOwnerTab: 'home', // 'home', 'balances', 'reports', 'staff', 'settings'
  activeProfileModalTab: 'passbook', // 'passbook', 'received', 'expenses'
  activeStaffTab: 'ledger', // 'ledger' or 'shared'
  activeStaffProfileName: null,
  isOnline: true,

  // Selected filters
  filters: {
    search: '',
    staff: '',
    category: '',
    startDate: '',
    endDate: ''
  },

  // Database cache
  data: {
    staff: [],
    transactions: [], // Advances issued to staff
    expenses: [], // Staff expenses + Owner company expenses
    incoming_money: [] // Staff recorded incoming money
  },

  // Temp form fields
  selectedCategory: '',
  tempReceiptData: null,
  tempGpsCoords: null,
  tempIncomingProofData: null, // Temp holder for incoming money proof

  // Login variables
  loginSelectedUser: null,
  enteredPin: '',

  // Initialize App
  async init() {
    console.log('TrailCash app initializing...');
    
    // Bind form event handlers
    this.renderCategoryGrid();
    this.initTheme();
    this.initLanguage();

    try {
      // Connect to the Supabase-backed data layer.
      await window.TrailCashDB.initAndSeed();

      const { data: { session } } = await window.supabaseInstance.auth.getSession();
      if (session) {
        await this.refreshData();
        const { data: { user } } = await window.supabaseInstance.auth.getUser();
        const profile = this.data.staff.find(staff => staff.id === user?.id);
        if (profile) this.currentUser = profile.name;
      } else {
        this.data.staff = await window.TrailCashDB.getLoginProfiles();
      }

      // Setup login profiles grid
      this.renderLoginProfiles();

      // Setup Supabase Realtime Changes Subscription
      if (window.supabaseInstance) {
        window.supabaseInstance
          .channel('schema-db-changes')
          .on('postgres_changes', { event: '*', schema: 'public' }, () => {
            console.log('Realtime DB change detected. Refreshing...');
            this.refreshData().then(() => this.updateView());
          })
          .subscribe();
      }

      // GPS simulation
      this.fetchGpsLocation();

      // Setup background periodic synchronization every 10 seconds
      setInterval(async () => {
        await this.syncWithServer();
        await this.refreshData();
        this.updateView();
      }, 10000);

      // Listen to online status
      this.isOnline = navigator.onLine;
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
      this.syncNetworkUI();

      this.showToast('TrailCash is ready.', 'success');
    } catch (err) {
      console.error('Init error:', err);
      this.showToast('Database error: ' + (err.message || err) + '. Using offline fallback.', 'warning');
      this.renderLoginProfiles();
    }
  },

  async syncWithServer() {
    if (!this.currentUser) return;
    try {
      await window.TrailCashDB.syncOfflineQueue();
      await this.refreshData();
      this.isOnline = navigator.onLine;
      this.syncNetworkUI();
    } catch (err) {
      console.warn('Central sync failed. Operating in local offline mode:', err);
      this.isOnline = false;
      this.syncNetworkUI();
    }
  },

  async refreshData() {
    this.data.staff = await window.TrailCashDB.getStaff();
    this.data.transactions = await window.TrailCashDB.getCashTransactions();
    this.data.expenses = await window.TrailCashDB.getExpenses();
    this.data.incoming_money = await window.TrailCashDB.getIncomingMoney();
  },

  // Active staff helper
  get STAFF_LIST() {
    return this.data.staff.filter(s => s.role === 'Staff' && s.status === 'Active');
  },

  // Theme support
  initTheme() {
    const theme = localStorage.getItem('trailcash_theme') || 'dark';
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  },

  toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('trailcash_theme', isLight ? 'light' : 'dark');
    this.showToast(isLight ? 'Switched to Light Theme' : 'Switched to Dark Theme', 'success');
  },

  // Language support
  initLanguage() {
    const lang = localStorage.getItem('trailcash_lang') || 'en';
    this.setLanguage(lang);
  },

  toggleLanguage() {
    const nextLang = this.currentLanguage === 'en' ? 'hi' : 'en';
    this.setLanguage(nextLang);
  },

  setLanguage(lang) {
    this.currentLanguage = lang;
    localStorage.setItem('trailcash_lang', lang);

    // Update lang button text
    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
      langBtn.innerHTML = `🌐 ${lang === 'en' ? 'EN' : 'हिंदी'}`;
    }

    // Translate statically tagged strings
    const langMap = {
      en: {
        brandName: "TrailCash",
        roleLabel: "Role:",
        onlineSynced: "Online / Synced",
        offlineText: "Offline (Local Only)",
        totalIssued: "Total Issued",
        totalSpent: "Total Spent",
        cashLeft: "Cash Left",
        myCashLimit: "My Cash Advance",
        navDashboard: "Dates",
        logoutText: "Logout"
      },
      hi: {
        brandName: "ट्रेलकैश",
        roleLabel: "भूमिका:",
        onlineSynced: "ऑनलाइन / सिंकड",
        offlineText: "ऑफ़लाइन (केवल लोकल)",
        totalIssued: "कुल जारी एडवांस",
        totalSpent: "कुल खर्च",
        cashLeft: "बचा हुआ कैश",
        myCashLimit: "मेरा एडवांस एडवांस",
        navDashboard: "तिथियां",
        logoutText: "लॉग आउट"
      }
    };

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (langMap[lang] && langMap[lang][key]) {
        el.textContent = langMap[lang][key];
      }
    });

    this.renderCategoryGrid();
    this.updateView();
  },

  handleNetworkChange(online) {
    this.isOnline = online;
    this.syncNetworkUI();
    if (online) {
      this.showToast('Network restored. Syncing drafts...', 'success');
      this.syncPendingExpenses();
    } else {
      this.showToast('Network offline. Saving items locally...', 'warning');
    }
  },

  syncNetworkUI() {
    const btn = document.getElementById('networkToggleBtn');
    const text = document.getElementById('networkText');
    if (!btn || !text) return;
    if (this.isOnline) {
      btn.className = 'network-toggle online';
      text.textContent = this.currentLanguage === 'en' ? 'Online / Synced' : 'ऑनलाइन / सिंकड';
    } else {
      btn.className = 'network-toggle offline';
      text.textContent = this.currentLanguage === 'en' ? 'Offline (Local Only)' : 'ऑफ़लाइन (केवल लोकल)';
    }
  },

  async forceSyncSimulation() {
    this.isOnline = true;
    this.syncNetworkUI();
    this.showToast('Synchronizing offline items...', 'success');
    await this.syncPendingExpenses();
  },

  async syncPendingExpenses() {
    let synced = 0;
    for (const exp of this.data.expenses) {
      if (exp.pendingSync) {
        exp.pendingSync = false;
        exp.isSynced = true;
        await window.TrailCashDB.updateExpense(exp);
        synced++;
      }
    }
    if (synced > 0) {
      this.showToast(`Synced ${synced} draft expenses!`, 'success');
      await this.refreshData();
      this.updateView();
    }
  },

  /* ==================== LOGIN SCREEN ==================== */
  renderLoginProfiles() {
    const grid = document.getElementById('loginUsersGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // Sort: Owner Rishabh first, then active staff
    const owner = this.data.staff.find(s => s.role === 'Owner');
    const staff = this.STAFF_LIST;
    const all = [];
    if (owner) all.push(owner);
    all.push(...staff);

    all.forEach(u => {
      const card = document.createElement('div');
      card.className = `login-user-card ${this.loginSelectedUser?.id === u.id ? 'selected-user' : ''}`;
      
      const initials = u.name.substring(0, 2).toUpperCase();
      const roleLabel = u.role === 'Owner' ? (this.currentLanguage === 'en' ? 'Owner' : 'मालिक') : '';
      
      card.innerHTML = `
        <div class="login-avatar">${initials}</div>
        <div class="login-user-name">${u.name} ${roleLabel ? `(${roleLabel})` : ''}</div>
      `;
      card.onclick = () => this.selectLoginUser(u);
      grid.appendChild(card);
    });
  },

  selectLoginUser(user) {
    this.loginSelectedUser = user;
    this.enteredPin = '';
    this.renderLoginProfiles();

    document.getElementById('pinUserName').textContent = user.name;
    document.getElementById('pinUserInitials').textContent = user.name.substring(0, 2).toUpperCase();
    
    document.getElementById('loginUsersGrid').style.display = 'none';
    document.getElementById('loginSubtitle').style.display = 'none';
    document.getElementById('pinViewContainer').style.display = 'flex';
    document.getElementById('pinErrorText').classList.remove('active');
    
    this.updatePinDots();
  },

  cancelPinEntry() {
    this.loginSelectedUser = null;
    this.enteredPin = '';
    document.getElementById('loginUsersGrid').style.display = 'grid';
    document.getElementById('loginSubtitle').style.display = 'block';
    document.getElementById('pinViewContainer').style.display = 'none';
    this.renderLoginProfiles();
  },

  async pressPinKey(key) {
    if (this.enteredPin.length >= 4) return;
    this.enteredPin += key;
    this.updatePinDots();

    if (this.enteredPin.length === 4) {
      let loginSuccess = false;
      let errMsg = '';
      if (window.supabaseInstance) {
        try {
          const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: this.loginSelectedUser.id, pin: this.enteredPin })
          });
          const payload = await response.json();
          if (response.ok && payload.session?.access_token) {
            const { error } = await window.supabaseInstance.auth.setSession(payload.session);
            if (error) throw error;
            await this.refreshData();
            loginSuccess = true;
          } else {
            errMsg = payload.error || 'Unknown error';
          }
        } catch (err) {
          errMsg = err.message || err;
          console.error('Supabase authentication server error:', err);
        }
      } else {
        errMsg = 'Database connection not initialized.';
      }

      if (loginSuccess) {
        this.currentUser = this.loginSelectedUser.name;
        document.getElementById('loginOverlay').classList.remove('active');
        this.showToast(`Logged in: ${this.currentUser}`, 'success');
        
        // Reset navigation
        this.activeOwnerTab = 'home';
        this.activeStaffTab = 'ledger';
        this.clearOwnerFilters();

        this.loginSelectedUser = null;
        this.enteredPin = '';
        this.updateView();
      } else {
        const container = document.getElementById('pinViewContainer');
        container.classList.add('shake-element');
        const errText = document.getElementById('pinErrorText');
        errText.textContent = this.currentLanguage === 'en' 
          ? `Login failed: ${errMsg}` 
          : `लॉगिन विफल: ${errMsg}`;
        errText.classList.add('active');
        
        setTimeout(() => {
          container.classList.remove('shake-element');
        }, 350);

        this.enteredPin = '';
        this.updatePinDots();
      }
    }
  },

  pressPinBackspace() {
    if (this.enteredPin.length > 0) {
      this.enteredPin = this.enteredPin.slice(0, -1);
      this.updatePinDots();
      document.getElementById('pinErrorText').classList.remove('active');
    }
  },

  updatePinDots() {
    const dots = document.getElementById('pinDots').children;
    for (let i = 0; i < 4; i++) {
      if (i < this.enteredPin.length) dots[i].classList.add('filled');
      else dots[i].classList.remove('filled');
    }
  },

  logoutUser() {
    if (navigator.onLine && window.supabaseInstance) {
      window.supabaseInstance.auth.signOut().catch(err => console.error('SignOut error:', err));
    }
    this.currentUser = null;
    document.getElementById('loginOverlay').classList.add('active');
    this.cancelPinEntry();
    this.updateView();
  },

  /* ==================== SCREEN ROUTING ==================== */
  updateView() {
    const ownerHome = document.getElementById('ownerHomeTab');
    const ownerBalances = document.getElementById('ownerBalancesTab');
    const ownerReports = document.getElementById('ownerReportsTab');
    const ownerStaff = document.getElementById('ownerStaffTab');
    const ownerSettings = document.getElementById('ownerSettingsTab');
    const ownerNav = document.getElementById('ownerBottomNav');
    const staffHome = document.getElementById('staffHomeTab');

    // Update Active User Header
    const activeLabel = document.getElementById('headerActiveRoleName');
    if (activeLabel) {
      activeLabel.textContent = this.currentUser ? this.currentUser : 'Locked';
    }

    // Hide all owner screens by default
    ownerHome.style.display = 'none';
    ownerBalances.style.display = 'none';
    ownerReports.style.display = 'none';
    ownerStaff.style.display = 'none';
    ownerSettings.style.display = 'none';
    ownerNav.style.display = 'none';
    staffHome.style.display = 'none';

    if (!this.currentUser) return; // Keep locked

    // Check Role
    const userProfile = this.data.staff.find(s => s.name === this.currentUser);
    const isOwner = userProfile && userProfile.role === 'Owner';

    if (isOwner) {
      ownerNav.style.display = 'grid';
      
      // Update nav class highlights
      document.getElementById('navHomeBtn').classList.remove('active');
      document.getElementById('navBalancesBtn').classList.remove('active');
      document.getElementById('navReportsBtn').classList.remove('active');
      document.getElementById('navStaffBtn').classList.remove('active');
      document.getElementById('navSettingsBtn').classList.remove('active');

      if (this.activeOwnerTab === 'home') {
        ownerHome.style.display = 'block';
        document.getElementById('navHomeBtn').classList.add('active');
        this.renderDatewiseDashboard();
      } else if (this.activeOwnerTab === 'balances') {
        ownerBalances.style.display = 'block';
        document.getElementById('navBalancesBtn').classList.add('active');
        this.renderOwnerStaffDashboard();
      } else if (this.activeOwnerTab === 'reports') {
        ownerReports.style.display = 'block';
        document.getElementById('navReportsBtn').classList.add('active');
        this.renderReports();
        this.renderCompanyExpenses();
      } else if (this.activeOwnerTab === 'staff') {
        ownerStaff.style.display = 'block';
        document.getElementById('navStaffBtn').classList.add('active');
        this.renderManageStaff();
      } else if (this.activeOwnerTab === 'settings') {
        ownerSettings.style.display = 'block';
        document.getElementById('navSettingsBtn').classList.add('active');
      }
    } else {
      // Staff view
      staffHome.style.display = 'block';
      this.renderStaffDashboard();
    }
  },

  switchOwnerTab(tab) {
    this.activeOwnerTab = tab;
    this.updateView();
  },

  /* ==================== BALANCES & STATS COMPUTATION ==================== */
  getStaffBalances(staffName, isOwnerView = false) {
    // Money sent to this staff member by Owner
    const receivedFromOwner = this.data.transactions
      .filter(t => t.staffName === staffName)
      .reduce((sum, t) => sum + t.amount, 0);

    // Incoming money recorded by this staff member (Approved)
    const approvedIncoming = (this.data.incoming_money || [])
      .filter(i => i.createdBy === staffName && i.status === 'Approved')
      .reduce((sum, i) => sum + i.amount, 0);

    // Incoming money recorded by this staff member (Pending)
    const pendingIncoming = (this.data.incoming_money || [])
      .filter(i => i.createdBy === staffName && i.status === 'Pending Approval')
      .reduce((sum, i) => sum + i.amount, 0);

    // If Owner is viewing, count only Approved. If Staff is viewing, count Approved + Pending Approval.
    const received = receivedFromOwner + approvedIncoming + (isOwnerView ? 0 : pendingIncoming);

    // Money spent by this staff member
    const spent = this.data.expenses
      .filter(e => e.staffName === staffName && !e.isOwnerExpense)
      .reduce((sum, e) => sum + e.amount, 0);

    const balance = received - spent;
    const expenseCount = this.data.expenses.filter(e => e.staffName === staffName && !e.isOwnerExpense).length;

    return { 
      received, 
      receivedFromOwner,
      approvedIncoming,
      pendingIncoming,
      spent, 
      balance, 
      expenseCount 
    };
  },
  /* ==================== FEATURE 3: DATE-WISE DASHBOARD ==================== */
  renderDatewiseDashboard() {
    this.renderOwnerApprovals();
    this.renderOwnerActivityFeed();

    const container = document.getElementById('dateCardsContainer');
    container.innerHTML = '';

    // Populate filter selectors if empty
    this.populateFilterDropdowns();

    // Gather unique dates from matching transactions, expenses, and incoming money
    const filteredTx = this.getFilteredTransactions();
    const filteredExp = this.getFilteredExpenses();
    const filteredInc = (this.data.incoming_money || []).filter(i => {
      if (this.filters.staff && i.createdBy !== this.filters.staff) return false;
      if (this.filters.startDate && i.dateTime.split('T')[0] < this.filters.startDate) return false;
      if (this.filters.endDate && i.dateTime.split('T')[0] > this.filters.endDate) return false;
      return true;
    });

    const dateSet = new Set();
    filteredTx.forEach(t => dateSet.add(t.dateTime.split('T')[0]));
    filteredExp.forEach(e => dateSet.add(e.dateTime.split('T')[0]));
    filteredInc.forEach(i => dateSet.add(i.dateTime.split('T')[0]));

    const uniqueDates = Array.from(dateSet).sort((a, b) => new Date(b) - new Date(a));

    if (uniqueDates.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.8rem;">No activities found.</div>`;
      this.updateCompanyTotals(0, 0, 0);
      return;
    }

    // Totals for current filter
    let grandSent = 0;
    let grandSpent = 0;

    uniqueDates.forEach(dateStr => {
      const dateTx = filteredTx.filter(t => t.dateTime.split('T')[0] === dateStr);
      const dateExp = filteredExp.filter(e => e.dateTime.split('T')[0] === dateStr);
      const dateInc = filteredInc.filter(i => i.dateTime.split('T')[0] === dateStr && i.status === 'Approved');

      const moneySent = dateTx.reduce((sum, t) => sum + t.amount, 0) + dateInc.reduce((sum, i) => sum + i.amount, 0);
      const moneySpent = dateExp.reduce((sum, e) => sum + e.amount, 0);
      const dailyBalance = moneySent - moneySpent;

      grandSent += moneySent;
      grandSpent += moneySpent;

      // Render date card
      const dt = new Date(dateStr);
      const formattedDate = dt.toLocaleDateString(this.currentLanguage === 'en' ? 'en-IN' : 'hi-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const card = document.createElement('div');
      card.className = 'date-card';
      card.onclick = () => this.openDateDetails(dateStr);
      card.innerHTML = `
        <div class="date-card-header">
          <span class="date-card-title">${formattedDate}</span>
          <span style="color: var(--primary); font-size: 0.75rem; font-weight: 600;">View Activities ➔</span>
        </div>
        <div class="date-card-grid">
          <div class="date-card-stat">
            <span style="color: var(--text-muted); font-size: 0.65rem;">Money Sent</span>
            <strong style="color: var(--accent-blue);">₹${moneySent.toLocaleString('en-IN')}</strong>
          </div>
          <div class="date-card-stat">
            <span style="color: var(--text-muted); font-size: 0.65rem;">Money Spent</span>
            <strong style="color: var(--warning);">₹${moneySpent.toLocaleString('en-IN')}</strong>
          </div>
          <div class="date-card-stat">
            <span style="color: var(--text-muted); font-size: 0.65rem;">Net Balance</span>
            <strong style="color: ${dailyBalance >= 0 ? 'var(--primary)' : 'var(--danger)'};">₹${dailyBalance.toLocaleString('en-IN')}</strong>
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    this.updateCompanyTotals(grandSent, grandSpent, grandSent - grandSpent);
  },

  updateCompanyTotals(issued, spent, balance) {
    document.getElementById('companyTotalIssued').textContent = `₹${issued.toLocaleString('en-IN')}`;
    document.getElementById('companyTotalSpent').textContent = `₹${spent.toLocaleString('en-IN')}`;
    document.getElementById('companyTotalBalance').textContent = `₹${balance.toLocaleString('en-IN')}`;
  },

  renderOwnerActivityFeed() {
    const feedContainer = document.getElementById('ownerActivityFeedContainer');
    if (!feedContainer) return;
    feedContainer.innerHTML = '';

    const feedEvents = [];

    // 1. Owner cash issues
    this.data.transactions.forEach(t => {
      feedEvents.push({
        time: new Date(t.dateTime),
        text: `Owner sent <strong>₹${t.amount.toLocaleString('en-IN')}</strong> to ${t.staffName} (${t.mode})`,
        icon: '💵',
        color: 'var(--accent-blue)'
      });
    });

    // 2. Logged expenses (staff and company)
    this.data.expenses.forEach(e => {
      const verb = e.receiptPhoto ? 'uploaded' : 'added';
      const noun = e.receiptPhoto ? 'bill' : 'expense';
      const staffLabel = e.isOwnerExpense ? 'Owner (Company)' : e.staffName;
      feedEvents.push({
        time: new Date(e.dateTime),
        text: `${staffLabel} ${verb} <strong>${e.category}</strong> ${noun} <strong>₹${e.amount.toLocaleString('en-IN')}</strong>`,
        icon: e.receiptPhoto ? '📄' : '💸',
        color: 'var(--warning)'
      });
    });

    // 3. Incoming money records
    (this.data.incoming_money || []).forEach(i => {
      const statusLabel = i.status === 'Approved' ? 'Approved' : (i.status === 'Pending Approval' ? 'Pending' : 'Rejected');
      const statusColor = i.status === 'Approved' ? 'var(--primary)' : (i.status === 'Pending Approval' ? 'var(--warning)' : 'var(--danger)');
      feedEvents.push({
        time: new Date(i.dateTime),
        text: `${i.createdBy} recorded Incoming <strong>₹${i.amount.toLocaleString('en-IN')}</strong> from ${i.receivedFrom} <span style="color: ${statusColor}; font-weight: bold;">(${statusLabel})</span>`,
        icon: '📥',
        color: 'var(--primary)'
      });
    });

    // Sort newest first
    feedEvents.sort((a, b) => b.time - a.time);

    // Slice to top 20 events
    const topEvents = feedEvents.slice(0, 20);

    if (topEvents.length === 0) {
      feedContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 12px; font-size: 0.7rem;">No recent activities.</div>`;
      return;
    }

    topEvents.forEach(ev => {
      const item = document.createElement('div');
      item.style.cssText = 'background: rgba(255,255,255,0.01); border: 1px solid var(--panel-border); border-radius: 8px; padding: 6px 10px; display: flex; align-items: center; gap: 8px; line-height: 1.3; margin-bottom: 4px;';
      
      const dateStr = ev.time.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const timeStr = ev.time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      item.innerHTML = `
        <span style="font-size: 1rem; flex-shrink: 0;">${ev.icon}</span>
        <div style="flex: 1;">
          <span style="color: var(--text-muted); font-size: 0.6rem; display: block; font-weight: 500;">${dateStr}, ${timeStr}</span>
          <span style="color: var(--text-primary); font-size: 0.72rem; line-height: 1.25; display: block;">${ev.text}</span>
        </div>
      `;
      feedContainer.appendChild(item);
    });
  },

  renderOwnerApprovals() {
    const card = document.getElementById('ownerApprovalsCard');
    const container = document.getElementById('ownerApprovalsContainer');
    const badge = document.getElementById('ownerApprovalsBadge');
    if (!card || !container) return;

    const pendings = (this.data.incoming_money || []).filter(i => i.status === 'Pending Approval');
    
    if (pendings.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    badge.textContent = pendings.length;
    container.innerHTML = '';

    pendings.forEach(p => {
      const dt = new Date(p.dateTime);
      const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
      
      const row = document.createElement('div');
      row.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 0.75rem;';
      
      row.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <strong style="color: var(--warning); font-size: 0.8rem;">₹${p.amount.toLocaleString('en-IN')}</strong> from <strong>${p.receivedFrom}</strong>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 1px;">
              Logged by: <strong>${p.createdBy}</strong> on ${dateStr} ${timeStr}
            </div>
            <div style="font-size: 0.65rem; color: var(--text-secondary); margin-top: 2px;">
              Payee: "${p.name}" • Method: ${p.paymentMethod}
              ${p.remarks ? ` • Remarks: "${p.remarks}"` : ''}
            </div>
          </div>
          ${p.proofPhoto ? `
            <span style="color: var(--primary); cursor: pointer; text-decoration: underline; font-size: 0.65rem; font-weight: bold;" onclick="app.viewIncomingProof('${p.id}')">
              View Proof 📄
            </span>
          ` : '<span style="color: var(--text-muted); font-size: 0.65rem;">No Proof</span>'}
        </div>
        
        <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px;">
          <input type="text" id="comment-${p.id}" class="form-input" placeholder="Add optional comment..." style="font-size: 0.7rem; padding: 6px 8px; margin-bottom: 0; flex: 1;">
          <button class="btn btn-secondary" onclick="app.handleRejectIncomingAction('${p.id}')" style="padding: 6px 10px; font-size: 0.7rem; color: var(--danger); border-color: rgba(239, 68, 68, 0.2); background: transparent;">Reject</button>
          <button class="btn" onclick="app.handleApproveIncomingAction('${p.id}')" style="padding: 6px 10px; font-size: 0.7rem; background: var(--primary); color: #000; font-weight: bold;">Approve</button>
        </div>
      `;
      container.appendChild(row);
    });
  },

  handleApproveIncomingAction(id) {
    const comment = document.getElementById(`comment-${id}`).value.trim();
    this.approveIncomingMoney(id, comment);
  },

  handleRejectIncomingAction(id) {
    const comment = document.getElementById(`comment-${id}`).value.trim();
    if (!comment) {
      if (!confirm('Warning: Rejecting without a comment. Click OK to proceed, or Cancel to add a comment.')) {
        return;
      }
    }
    this.rejectIncomingMoney(id, comment);
  },

  viewIncomingProof(id) {
    const record = this.data.incoming_money.find(i => i.id === id);
    if (!record || !record.proofPhoto) return;

    // Reuse existing viewer overlay by creating a temp mockup overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '2000';
    overlay.innerHTML = `
      <div class="modal-content" style="max-height: 85%;">
        <div class="modal-header">
          <h2 class="modal-title">Payment Proof Preview</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="text-align: center; overflow: auto; padding: 10px;">
          <img src="${record.proofPhoto}" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  /* ==================== FEATURE 4: OWNER DASHBOARD (STAFF CARDS) ==================== */
  renderOwnerStaffDashboard() {
    const container = document.getElementById('ownerStaffCardsContainer');
    container.innerHTML = '';

    const staffMembers = this.STAFF_LIST;

    if (staffMembers.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 12px; color: var(--text-muted); grid-column: span 2;">No active staff.</div>`;
      return;
    }

    staffMembers.forEach(s => {
      const stats = this.getStaffBalances(s.name, true);
      const initials = s.name.substring(0, 2).toUpperCase();

      const card = document.createElement('div');
      card.className = 'staff-card';
      card.onclick = () => this.openStaffProfile(s.name);
      card.innerHTML = `
        <div class="staff-card-avatar">${initials}</div>
        <div class="staff-card-name">${s.name}</div>
        
        <div class="staff-card-stats-grid">
          <div class="staff-card-stat">
            <span>Received:</span>
            <strong style="color: var(--accent-blue);">₹${stats.received.toLocaleString('en-IN')}</strong>
          </div>
          <div class="staff-card-stat">
            <span>Spent:</span>
            <strong style="color: var(--warning);">₹${stats.spent.toLocaleString('en-IN')}</strong>
          </div>
        </div>
        
        <div class="staff-card-balance">
          <span style="font-size: 0.7rem; color: var(--text-muted); align-self: center;">Available:</span>
          <strong>₹${stats.balance.toLocaleString('en-IN')}</strong>
        </div>
      `;
      container.appendChild(card);
    });
  },

  /* ==================== FEATURE 5: STAFF PROFILE & LEDGER ==================== */
  openStaffProfile(staffName) {
    this.activeStaffProfileName = staffName;
    this.activeProfileModalTab = 'passbook';
    
    // Set active style for tabs
    document.getElementById('profileTabPassbookBtn').className = 'role-chip active';
    document.getElementById('profileTabReceivedBtn').className = 'role-chip';
    document.getElementById('profileTabIncomingBtn').className = 'role-chip';
    document.getElementById('profileTabExpensesBtn').className = 'role-chip';

    document.getElementById('indivStaffTitleName').textContent = staffName;
    this.renderStaffProfileModalContent();
    this.openModal('staffLedgerModal');
  },

  switchProfileModalTab(tabName) {
    this.activeProfileModalTab = tabName;
    
    document.getElementById('profileTabPassbookBtn').className = `role-chip ${tabName === 'passbook' ? 'active' : ''}`;
    document.getElementById('profileTabReceivedBtn').className = `role-chip ${tabName === 'received' ? 'active' : ''}`;
    document.getElementById('profileTabIncomingBtn').className = `role-chip ${tabName === 'incoming' ? 'active' : ''}`;
    document.getElementById('profileTabExpensesBtn').className = `role-chip ${tabName === 'expenses' ? 'active' : ''}`;

    this.renderStaffProfileModalContent();
  },

  renderStaffProfileModalContent() {
    const staffName = this.activeStaffProfileName;
    const isOwner = (this.currentUser === 'Rishabh');
    const stats = this.getStaffBalances(staffName, isOwner);

    // Set stats header
    document.getElementById('indivStaffIssued').textContent = `₹${stats.received.toLocaleString('en-IN')}`;
    document.getElementById('indivStaffSpent').textContent = `₹${stats.spent.toLocaleString('en-IN')}`;
    document.getElementById('indivStaffRemaining').textContent = `₹${stats.balance.toLocaleString('en-IN')}`;
    document.getElementById('indivStaffCount').textContent = stats.expenseCount;

    const container = document.getElementById('profileTabContentArea');
    container.innerHTML = '';

    if (this.activeProfileModalTab === 'passbook') {
      // 1. Passbook Running Ledger
      // Combine cash advances, approved incoming, and staff expenses chronologically
      const advances = this.data.transactions
        .filter(t => t.staffName === staffName)
        .map(t => ({ ...t, passType: 'credit', docType: 'Owner Sent' }));

      // Include Pending items too for the staff member themselves, but only Approved for the Owner
      const incoming = (this.data.incoming_money || [])
        .filter(i => i.createdBy === staffName && (i.status === 'Approved' || (!isOwner && i.status === 'Pending Approval')))
        .map(i => ({ ...i, passType: 'credit', docType: 'Incoming', isPending: i.status === 'Pending Approval' }));

      const spends = this.data.expenses
        .filter(e => e.staffName === staffName && !e.isOwnerExpense)
        .map(e => ({ ...e, passType: 'debit', docType: 'Expense' }));

      const unified = [...advances, ...incoming, ...spends].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

      if (unified.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 12px;">Passbook is empty. No history.</div>`;
        return;
      }

      let runningBal = 0;
      
      // Render passbook lines chronologically
      unified.forEach(item => {
        const row = document.createElement('div');
        row.className = 'passbook-row';
        
        const dt = new Date(item.dateTime);
        const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

        if (item.passType === 'credit') {
          runningBal += item.amount;
          let label = 'Received Advance';
          let badgeText = 'Credit';
          let extra = '';
          if (item.docType === 'Incoming') {
            label = `Incoming: ${item.receivedFrom}`;
            badgeText = item.isPending ? 'Pending' : 'Incoming';
            if (item.isPending) {
              extra = ` <span style="font-size:0.6rem; color:var(--warning); font-weight:bold;">(Pending)</span>`;
            }
          } else {
            extra = item.refNumber ? `(${item.refNumber})` : '';
          }

          row.innerHTML = `
            <div class="passbook-details">
              <span class="passbook-date">${dateStr} ${timeStr}</span>
              <span class="passbook-desc" style="color: var(--accent-blue); font-weight: 600;">${label} ${extra}</span>
              <span class="passbook-type-badge" style="background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); border-color: rgba(59, 130, 246, 0.2);">${badgeText}</span>
            </div>
            <div class="passbook-amounts">
              <span class="passbook-amount credit">+₹${item.amount.toLocaleString('en-IN')}</span>
              <span class="passbook-running-bal">Bal: ₹${runningBal.toLocaleString('en-IN')}</span>
            </div>
          `;
        } else {
          runningBal -= item.amount;
          const label = item.customCategory ? `${item.category} (${item.customCategory})` : item.category;
          row.innerHTML = `
            <div class="passbook-details">
              <span class="passbook-date">${dateStr} ${timeStr}</span>
              <span class="passbook-desc" style="color: var(--warning);">${label} - ${item.description}</span>
              <span class="passbook-type-badge passbook-type-out">Debit</span>
            </div>
            <div class="passbook-amounts">
              <span class="passbook-amount debit">-₹${item.amount.toLocaleString('en-IN')}</span>
              <span class="passbook-running-bal">Bal: ₹${runningBal.toLocaleString('en-IN')}</span>
            </div>
          `;
        }
        // Insert at top to display latest passbook rows at top
        container.insertBefore(row, container.firstChild);
      });

      // Append Opening Balance
      const openRow = document.createElement('div');
      openRow.className = 'passbook-row';
      openRow.style.opacity = '0.7';
      openRow.innerHTML = `
        <div class="passbook-details">
          <span class="passbook-date">-</span>
          <span class="passbook-desc" style="font-weight: 700;">Opening Balance</span>
        </div>
        <div class="passbook-amounts">
          <span class="passbook-amount" style="color: var(--text-secondary);">₹0</span>
        </div>
      `;
      container.appendChild(openRow);

    } else if (this.activeProfileModalTab === 'received') {
      // 2. Money Received History (Sent by Owner)
      const advances = this.data.transactions
        .filter(t => t.staffName === staffName)
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

      if (advances.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 12px;">No money sent logs.</div>`;
        return;
      }

      advances.forEach(tx => {
        const item = document.createElement('div');
        item.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 12px; padding: 10px; display: flex; justify-content: space-between; align-items: center; border-left: 3px solid var(--accent-blue);';
        
        const dt = new Date(tx.dateTime);
        const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

        item.innerHTML = `
          <div>
            <strong style="color: var(--accent-blue); font-size: 0.85rem;">Received Advance</strong>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">
              ${dateStr} ${timeStr} • Mode: ${tx.mode}
            </div>
            ${tx.refNumber ? `<div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 2px; font-style: italic;">"${tx.refNumber}"</div>` : ''}
          </div>
          <strong style="font-size: 0.95rem; color: var(--accent-blue);">₹${tx.amount.toLocaleString('en-IN')}</strong>
        `;
        container.appendChild(item);
      });

    } else if (this.activeProfileModalTab === 'incoming') {
      // 3. Incoming Money Tab
      const incoming = (this.data.incoming_money || [])
        .filter(i => i.createdBy === staffName)
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

      if (incoming.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 12px;">No incoming money entries.</div>`;
        return;
      }

      incoming.forEach(p => {
        const dt = new Date(p.dateTime);
        const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        
        let statusBadge = '';
        let badgeColor = 'var(--text-muted)';
        if (p.status === 'Approved') {
          statusBadge = '✅ Approved';
          badgeColor = 'var(--primary)';
        } else if (p.status === 'Pending Approval') {
          statusBadge = '⏳ Pending';
          badgeColor = 'var(--warning)';
        } else {
          statusBadge = '❌ Rejected';
          badgeColor = 'var(--danger)';
        }

        const item = document.createElement('div');
        item.style.cssText = `background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 4px; border-left: 3px solid ${badgeColor};`;
        
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.8rem; color: var(--text-primary);">📥 From: ${p.receivedFrom}</strong>
            <strong style="font-size: 0.85rem; color: ${badgeColor}; font-weight: bold;">₹${p.amount.toLocaleString('en-IN')}</strong>
          </div>
          <div style="font-size: 0.65rem; color: var(--text-muted);">
            ${dateStr} ${timeStr} • Method: ${p.paymentMethod} • Source: "${p.name}"
            ${p.remarks ? `<span style="display: block; font-style: italic; color: var(--text-secondary); margin-top: 1px;">Remarks: "${p.remarks}"</span>` : ''}
          </div>
          <div style="font-size: 0.65rem; font-weight: bold; display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
            <span style="color: ${badgeColor};">Status: ${statusBadge}</span>
            ${p.proofPhoto ? `
              <span style="color: var(--primary); cursor: pointer; text-decoration: underline;" onclick="app.viewIncomingProofFromLedger('${p.id}')">
                View Proof 📄
              </span>
            ` : ''}
          </div>
          ${p.reviewedBy ? `
            <div style="font-size: 0.65rem; color: var(--text-secondary); background: rgba(255,255,255,0.01); border-left: 2px solid ${badgeColor}; padding-left: 6px; margin-top: 4px; display: flex; flex-direction: column; gap: 1px;">
              <span>Audited by: <strong>${p.reviewedBy}</strong> on ${new Date(p.reviewedAt).toLocaleDateString('en-IN')}</span>
              ${p.comment ? `<span>Comment: "${p.comment}"</span>` : ''}
            </div>
          ` : ''}
        `;
        container.appendChild(item);
      });

    } else if (this.activeProfileModalTab === 'expenses') {
      // 4. Expense History Chronological
      const spends = this.data.expenses
        .filter(e => e.staffName === staffName && !e.isOwnerExpense)
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

      if (spends.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 12px;">No logged expenses.</div>`;
        return;
      }

      spends.forEach(exp => {
        const catObj = CATEGORIES.find(c => c.name === exp.category);
        const emoji = catObj ? catObj.emoji : '📦';
        const label = exp.customCategory ? `${exp.category} (${exp.customCategory})` : exp.category;
        
        const dt = new Date(exp.dateTime);
        const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

        const item = document.createElement('div');
        item.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 4px; border-left: 3px solid var(--warning);';
        
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.8rem; color: var(--text-primary);">${emoji} ${label}</strong>
            <strong style="font-size: 0.85rem; color: var(--warning);">₹${exp.amount.toLocaleString('en-IN')}</strong>
          </div>
          <div style="font-size: 0.65rem; color: var(--text-muted);">
            ${dateStr} ${timeStr} • Vendor: ${exp.vendorName || '-'} • ${exp.paymentMethod || 'Cash'}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic; border-left: 2px solid var(--primary); padding-left: 6px; margin-top: 2px;">
            "${exp.description}"
          </div>
          ${exp.receiptPhoto ? `
            <div style="margin-top: 4px; text-align: right;">
              <span style="font-size: 0.65rem; color: var(--primary); cursor: pointer; text-decoration: underline;" onclick="app.viewReceiptFromLedger('${exp.id}')">
                View Bill Attachment 📄
              </span>
            </div>
          ` : ''}
        `;
        container.appendChild(item);
      });
    }
  },

  viewReceiptFromLedger(expenseId) {
    this.closeModal('staffLedgerModal');
    setTimeout(() => {
      this.viewReceipt(expenseId);
    }, 250);
  },

  viewIncomingProofFromLedger(id) {
    this.closeModal('staffLedgerModal');
    setTimeout(() => {
      this.viewIncomingProof(id);
    }, 250);
  },

  /* ==================== STAFF DASHBOARD (PERSONAL VIEW & SHARED DASHBOARD) ==================== */
  switchStaffDashboardTab(tabName) {
    this.activeStaffTab = tabName;
    this.renderStaffDashboard();
  },

  renderStaffDashboard() {
    const staffName = this.currentUser;

    const personalContainer = document.getElementById('staffPersonalViewContainer');
    const sharedContainer = document.getElementById('staffSharedViewContainer');

    if (this.activeStaffTab === 'shared') {
      personalContainer.style.display = 'none';
      sharedContainer.style.display = 'block';

      document.getElementById('staffTabMyLedgerBtn').className = 'role-chip';
      document.getElementById('staffTabSharedDashBtn').className = 'role-chip active';

      this.renderStaffSharedDirectory();
      this.renderStaffSharedExpensesFeed();
      return;
    }

    // Otherwise render standard Personal Ledger
    personalContainer.style.display = 'block';
    sharedContainer.style.display = 'none';

    document.getElementById('staffTabMyLedgerBtn').className = 'role-chip active';
    document.getElementById('staffTabSharedDashBtn').className = 'role-chip';

    const stats = this.getStaffBalances(staffName);

    // Bind stats
    document.getElementById('staffLimitVal').textContent = `₹${stats.received.toLocaleString('en-IN')}`;
    document.getElementById('staffSpentVal').textContent = `₹${stats.spent.toLocaleString('en-IN')}`;
    document.getElementById('staffRemainingVal').textContent = `₹${stats.balance.toLocaleString('en-IN')}`;

    // Offline sync count display
    const unsynced = this.data.expenses.filter(e => e.staffName === staffName && e.pendingSync);
    const syncBanner = document.getElementById('offlineSyncBanner');
    const syncCountLabel = document.getElementById('unsyncedCountLabel');

    if (unsynced.length > 0) {
      syncBanner.style.display = 'block';
      syncCountLabel.textContent = `${unsynced.length} Unsynced Expenses Saved Locally`;
    } else {
      syncBanner.style.display = 'none';
    }

    // Populate personal passbook running ledger
    const container = document.getElementById('staffPassbookContainer');
    container.innerHTML = '';

    const advances = this.data.transactions
      .filter(t => t.staffName === staffName)
      .map(t => ({ ...t, passType: 'credit', docType: 'Advance' }));

    const incoming = (this.data.incoming_money || [])
      .filter(i => i.createdBy === staffName && i.status !== 'Rejected')
      .map(i => ({ ...i, passType: 'credit', docType: 'Incoming', isPending: i.status === 'Pending Approval' }));

    const spends = this.data.expenses
      .filter(e => e.staffName === staffName && !e.isOwnerExpense)
      .map(e => ({ ...e, passType: 'debit', docType: 'Expense' }));

    const unified = [...advances, ...incoming, ...spends].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

    if (unified.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 24px;">Your passbook ledger is empty.</div>`;
      return;
    }

    let runningBal = 0;

    unified.forEach(item => {
      const row = document.createElement('div');
      row.className = 'passbook-row';

      const dt = new Date(item.dateTime);
      const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

      if (item.passType === 'credit') {
        runningBal += item.amount;
        let label = 'Advance advances credited';
        let badgeText = 'Credit';
        let extra = '';
        if (item.docType === 'Incoming') {
          label = `Incoming: ${item.receivedFrom}`;
          badgeText = item.isPending ? 'Pending' : 'Incoming';
          if (item.isPending) {
            extra = ` <span style="font-size:0.6rem; color:var(--warning); font-weight:bold;">(Pending Approval)</span>`;
          }
        }

        row.innerHTML = `
          <div class="passbook-details">
            <span class="passbook-date">${dateStr} ${timeStr}</span>
            <span class="passbook-desc" style="color: var(--accent-blue); font-weight: 600;">${label} ${extra}</span>
            <span class="passbook-type-badge" style="background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); border-color: rgba(59, 130, 246, 0.2);">${badgeText}</span>
          </div>
          <div class="passbook-amounts">
            <span class="passbook-amount credit">+₹${item.amount.toLocaleString('en-IN')}</span>
            <span class="passbook-running-bal">Bal: ₹${runningBal.toLocaleString('en-IN')}</span>
          </div>
        `;
      } else {
        runningBal -= item.amount;
        const label = item.customCategory ? `${item.category} (${item.customCategory})` : item.category;
        
        // Show clickable details for draft receipts deletion
        const clickAction = item.pendingSync ? `onclick="app.viewReceipt('${item.id}')" style="cursor:pointer;"` : '';

        row.innerHTML = `
          <div class="passbook-details" ${clickAction}>
            <span class="passbook-date">${dateStr} ${timeStr} ${item.pendingSync ? '⏰' : ''}</span>
            <span class="passbook-desc">${label} - ${item.description}</span>
            <span class="passbook-type-badge passbook-type-out">Debit</span>
          </div>
          <div class="passbook-amounts">
            <span class="passbook-amount debit">-₹${item.amount.toLocaleString('en-IN')}</span>
            <span class="passbook-running-bal">Bal: ₹${runningBal.toLocaleString('en-IN')}</span>
          </div>
        `;
      }
      container.insertBefore(row, container.firstChild);
    });

    const openRow = document.createElement('div');
    openRow.className = 'passbook-row';
    openRow.style.opacity = '0.7';
    openRow.innerHTML = `
      <div class="passbook-details">
        <span class="passbook-date">-</span>
        <span class="passbook-desc" style="font-weight: 700;">Opening Balance</span>
      </div>
      <div class="passbook-amounts">
        <span class="passbook-amount" style="color: var(--text-secondary);">₹0</span>
      </div>
    `;
    container.appendChild(openRow);
  },

  renderStaffSharedDirectory() {
    const container = document.getElementById('staffDirectoryGrid');
    if (!container) return;
    container.innerHTML = '';

    const staffMembers = this.STAFF_LIST;

    if (staffMembers.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; grid-column: span 2;">No active staff.</div>`;
      return;
    }

    staffMembers.forEach(s => {
      const stats = this.getStaffBalances(s.name);
      const card = document.createElement('div');
      card.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 12px; padding: 10px; text-align: center; display: flex; flex-direction: column; gap: 4px;';
      
      const initials = s.name.substring(0, 2).toUpperCase();

      card.innerHTML = `
        <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--primary-glow); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; margin: 0 auto;">${initials}</div>
        <div style="font-weight: 700; font-size: 0.8rem; color: var(--text-primary);">${s.name}</div>
        <div style="font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase;">Available Cash</div>
        <div style="font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; color: var(--primary);">₹${stats.balance.toLocaleString('en-IN')}</div>
      `;
      container.appendChild(card);
    });
  },

  renderStaffSharedExpensesFeed() {
    const container = document.getElementById('staffSharedExpensesFeed');
    if (!container) return;
    container.innerHTML = '';

    const publicExpenses = this.data.expenses
      .filter(e => !e.isOwnerExpense)
      .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

    if (publicExpenses.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 24px;">No field expenses logged yet.</div>`;
      return;
    }

    publicExpenses.forEach(exp => {
      const label = exp.customCategory ? `${exp.category} (${exp.customCategory})` : exp.category;
      const catObj = CATEGORIES.find(c => c.name === exp.category);
      const emoji = catObj ? catObj.emoji : '📦';
      const dt = new Date(exp.dateTime);
      const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

      const row = document.createElement('div');
      row.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 4px;';
      
      row.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 0.8rem; color: var(--text-primary);">${exp.staffName} ➔ ${emoji} ${label}</strong>
          <strong style="font-size: 0.85rem; color: var(--warning);">₹${exp.amount.toLocaleString('en-IN')}</strong>
        </div>
        <div style="font-size: 0.65rem; color: var(--text-muted);">
          ${dateStr} ${timeStr} • Vendor: ${exp.vendorName || '-'} • ${exp.paymentMethod || 'Cash'}
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic; border-left: 2px solid var(--primary); padding-left: 6px; margin-top: 2px;">
          "${exp.description}"
        </div>
        ${exp.receiptPhoto ? `
          <div style="margin-top: 4px; text-align: right;">
            <span style="font-size: 0.65rem; color: var(--primary); cursor: pointer; text-decoration: underline;" onclick="app.viewReceipt('${exp.id}')">
              View Bill Attachment 📄
            </span>
          </div>
        ` : ''}
      `;
      container.appendChild(row);
    });
  },

  /* ==================== FEATURE 6: SEARCH & FILTERS ==================== */
  populateFilterDropdowns() {
    const staffSelect = document.getElementById('filterStaffSelect');
    const categorySelect = document.getElementById('filterCategorySelect');
    if (!staffSelect || !categorySelect) return;

    if (staffSelect.options.length <= 1) {
      this.STAFF_LIST.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name;
        staffSelect.appendChild(opt);
      });
    }

    if (categorySelect.options.length <= 1) {
      CATEGORIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        categorySelect.appendChild(opt);
      });
    }
  },

  getFilteredTransactions() {
    const s = this.filters.search.toLowerCase();
    const staff = this.filters.staff;
    const start = this.filters.startDate;
    const end = this.filters.endDate;

    return this.data.transactions.filter(t => {
      // Exclude transfers if any, only keep standard cash advance issues
      if (t.type === 'Transfer') return false;

      const dateStr = t.dateTime.split('T')[0];

      if (staff && t.staffName !== staff) return false;
      if (start && dateStr < start) return false;
      if (end && dateStr > end) return false;
      
      if (s) {
        const matchName = t.staffName.toLowerCase().includes(s);
        const matchRef = (t.refNumber || '').toLowerCase().includes(s);
        if (!matchName && !matchRef) return false;
      }

      return true;
    });
  },

  getFilteredExpenses() {
    const s = this.filters.search.toLowerCase();
    const staff = this.filters.staff;
    const cat = this.filters.category;
    const start = this.filters.startDate;
    const end = this.filters.endDate;

    return this.data.expenses.filter(e => {
      const dateStr = e.dateTime.split('T')[0];

      if (staff && e.staffName !== staff) return false;
      if (cat && e.category !== cat) return false;
      if (start && dateStr < start) return false;
      if (end && dateStr > end) return false;

      if (s) {
        const matchStaff = e.staffName.toLowerCase().includes(s);
        const matchCat = e.category.toLowerCase().includes(s);
        const matchDesc = e.description.toLowerCase().includes(s);
        const matchVendor = (e.vendorName || '').toLowerCase().includes(s);
        if (!matchStaff && !matchCat && !matchDesc && !matchVendor) return false;
      }

      return true;
    });
  },

  updateFiltersState() {
    this.filters.search = document.getElementById('ownerSearchInput').value;
    this.filters.staff = document.getElementById('filterStaffSelect').value;
    this.filters.category = document.getElementById('filterCategorySelect').value;
    this.filters.startDate = document.getElementById('filterStartDate').value;
    this.filters.endDate = document.getElementById('filterEndDate').value;
  },

  updateDashboardView() {
    this.updateFiltersState();
    this.renderDatewiseDashboard();
  },

  clearOwnerFilters() {
    document.getElementById('ownerSearchInput').value = '';
    document.getElementById('filterStaffSelect').value = '';
    document.getElementById('filterCategorySelect').value = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    
    this.filters = { search: '', staff: '', category: '', startDate: '', endDate: '' };
    this.renderDatewiseDashboard();
  },

  /* ==================== FEATURE 3 (SUB-VIEW): DATE DETAILS ACTIVITIES ==================== */
  openDateDetails(dateStr) {
    const dt = new Date(dateStr);
    const formatted = dt.toLocaleDateString(this.currentLanguage === 'en' ? 'en-IN' : 'hi-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    document.getElementById('dateDetailsTitle').textContent = `Activity: ${formatted}`;

    const sentContainer = document.getElementById('dateDetailsSentContainer');
    const expContainer = document.getElementById('dateDetailsExpensesContainer');

    sentContainer.innerHTML = '';
    expContainer.innerHTML = '';

    // Standard cash issues
    const dayTx = this.getFilteredTransactions().filter(t => t.dateTime.split('T')[0] === dateStr);
    // Expenses
    const dayExp = this.getFilteredExpenses().filter(e => e.dateTime.split('T')[0] === dateStr);
    // Incoming money entries
    const dayIncoming = (this.data.incoming_money || []).filter(i => {
      const isDate = i.dateTime.split('T')[0] === dateStr;
      if (!isDate) return false;
      if (this.filters.staff && i.createdBy !== this.filters.staff) return false;
      return true;
    });

    const approvedIncomingSum = dayIncoming
      .filter(i => i.status === 'Approved')
      .reduce((sum, i) => sum + i.amount, 0);

    const totalSent = dayTx.reduce((sum, t) => sum + t.amount, 0) + approvedIncomingSum;
    const totalSpent = dayExp.reduce((sum, e) => sum + e.amount, 0);
    const remaining = totalSent - totalSpent;

    // Gather chronological events list for the day
    const events = [];

    // 1. Advances issued by Owner
    dayTx.forEach(tx => {
      const dt = new Date(tx.dateTime);
      const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const remarks = tx.refNumber ? ` (${tx.refNumber})` : '';
      events.push({
        timeSort: tx.dateTime,
        timeDisplay: timeStr,
        icon: '💵',
        color: 'var(--accent-blue)',
        html: `<strong>Owner sent ₹${tx.amount.toLocaleString('en-IN')} to ${tx.staffName}</strong> via ${tx.mode}${remarks}`
      });
    });

    // 2. Incoming Money Entries creation and approvals
    dayIncoming.forEach(inc => {
      // Creation Log
      const cDate = inc.createdAt ? new Date(inc.createdAt) : new Date(inc.dateTime);
      const cDateStr = cDate.toISOString().split('T')[0];
      if (cDateStr === dateStr) {
        const timeStr = cDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        
        let statusBadge = '';
        if (inc.status === 'Approved') {
          statusBadge = '<span style="color: var(--primary); font-weight: bold;">(Approved)</span>';
        } else if (inc.status === 'Pending Approval') {
          statusBadge = '<span style="color: var(--warning); font-weight: bold;">(Pending Approval)</span>';
        } else {
          statusBadge = '<span style="color: var(--danger); font-weight: bold;">(Rejected)</span>';
        }

        events.push({
          timeSort: inc.createdAt || inc.dateTime,
          timeDisplay: timeStr,
          icon: '📥',
          color: 'var(--primary)',
          html: `<strong>${inc.createdBy} recorded Incoming Money of ₹${inc.amount.toLocaleString('en-IN')} from ${inc.receivedFrom}</strong> ${statusBadge}`
        });
      }

      // Audit review Log (Approve / Reject)
      if (inc.reviewedAt) {
        const rDate = new Date(inc.reviewedAt);
        const rDateStr = rDate.toISOString().split('T')[0];
        if (rDateStr === dateStr) {
          const timeStr = rDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          const statusVerb = inc.status === 'Approved' ? 'approved' : 'rejected';
          const icon = inc.status === 'Approved' ? '✅' : '❌';
          const commentStr = inc.comment ? ` • Comment: "${inc.comment}"` : '';

          events.push({
            timeSort: inc.reviewedAt,
            timeDisplay: timeStr,
            icon: icon,
            color: inc.status === 'Approved' ? 'var(--primary)' : 'var(--danger)',
            html: `<strong>${inc.reviewedBy} ${statusVerb} the Incoming Money entry</strong> from ${inc.createdBy}${commentStr}`
          });
        }
      }
    });

    // Sort events chronologically by timeSort string
    events.sort((a, b) => new Date(a.timeSort) - new Date(b.timeSort));

    // Render timeline
    if (events.length === 0) {
      sentContainer.innerHTML = `<div style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">No money sent or received activities.</div>`;
    } else {
      events.forEach(ev => {
        const item = document.createElement('div');
        item.style.cssText = 'background:rgba(255,255,255,0.01); border:1px solid var(--panel-border); border-radius:10px; padding:8px 10px; display:flex; gap:10px; align-items:center; font-size:0.75rem;';
        item.innerHTML = `
          <div style="font-size: 1.1rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15));">${ev.icon}</div>
          <div style="flex: 1;">
            <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 500;">${ev.timeDisplay}</div>
            <div style="color: var(--text-primary); margin-top: 1px; line-height: 1.35;">${ev.html}</div>
          </div>
        `;
        sentContainer.appendChild(item);
      });
    }

    // Render Logged Expenses (Both staff and company corporate office expenses)
    if (dayExp.length === 0) {
      expContainer.innerHTML = `<div style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">No expenses logged.</div>`;
    } else {
      dayExp.forEach(exp => {
        const label = exp.customCategory ? `${exp.category} (${exp.customCategory})` : exp.category;
        const item = document.createElement('div');
        item.style.cssText = 'background:rgba(255,255,255,0.01); border:1px solid var(--panel-border); border-radius:10px; padding:8px 10px; display:flex; justify-content:space-between; align-items:center; font-size:0.75rem;';
        
        const staffLabel = exp.isOwnerExpense ? 'Company' : exp.staffName;

        item.innerHTML = `
          <div>
            <strong>${staffLabel} (${label})</strong>
            <span style="color:var(--text-muted); display:block; font-size:0.65rem;">"${exp.description}" • Vendor: ${exp.vendorName || '-'}</span>
          </div>
          <strong style="color:var(--warning);">₹${exp.amount.toLocaleString('en-IN')}</strong>
        `;
        expContainer.appendChild(item);
      });
    }

    // Totals at bottom
    document.getElementById('dateDetailsTotalSent').textContent = `₹${totalSent.toLocaleString('en-IN')}`;
    document.getElementById('dateDetailsTotalSpent').textContent = `₹${totalSpent.toLocaleString('en-IN')}`;
    document.getElementById('dateDetailsRemaining').textContent = `₹${remaining.toLocaleString('en-IN')}`;

    this.openModal('dateDetailsModal');
  },

  renderReports() {
    const subContent = document.getElementById('reportsSubContent');
    subContent.innerHTML = '';

    const filterVal = document.getElementById('reportTypeFilter')?.value || 'All';

    // 1. Calculate sums
    const ownerSentSum = this.data.transactions.reduce((sum, t) => sum + t.amount, 0);
    const approvedIncomingSum = (this.data.incoming_money || [])
      .filter(i => i.status === 'Approved')
      .reduce((sum, i) => sum + i.amount, 0);
    const expensesSum = this.data.expenses.reduce((sum, e) => sum + e.amount, 0);

    let totalIssued = 0;
    let totalSpent = 0;

    if (filterVal === 'All') {
      totalIssued = ownerSentSum + approvedIncomingSum;
      totalSpent = expensesSum;
    } else if (filterVal === 'Sent') {
      totalIssued = ownerSentSum;
      totalSpent = 0;
    } else if (filterVal === 'Incoming') {
      totalIssued = approvedIncomingSum;
      totalSpent = 0;
    } else if (filterVal === 'Expenses') {
      totalIssued = 0;
      totalSpent = expensesSum;
    }

    const totalBalance = totalIssued - totalSpent;

    document.getElementById('reportTotalIssued').textContent = `₹${totalIssued.toLocaleString('en-IN')}`;
    document.getElementById('reportTotalSpent').textContent = `₹${totalSpent.toLocaleString('en-IN')}`;
    document.getElementById('reportTotalBalance').textContent = `₹${totalBalance.toLocaleString('en-IN')}`;

    // 2. Render Breakdown based on selected type
    if (filterVal === 'Expenses' || filterVal === 'All') {
      // Category breakdown for expenses
      const catMap = {};
      CATEGORIES.forEach(c => catMap[c.name] = 0);
      COMPANY_EXPENSE_CATEGORIES.forEach(c => catMap[c] = 0);

      this.data.expenses.forEach(e => {
        catMap[e.category] = (catMap[e.category] || 0) + e.amount;
      });

      const sortedCats = Object.entries(catMap)
        .filter(([_, amt]) => amt > 0)
        .sort((a, b) => b[1] - a[1]);

      if (sortedCats.length === 0) {
        subContent.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:0.75rem;">No expenses to summarize.</div>`;
        return;
      }

      sortedCats.forEach(([cat, amt]) => {
        const isCompanyCat = COMPANY_EXPENSE_CATEGORIES.includes(cat);
        const emoji = isCompanyCat ? '🏢' : (CATEGORIES.find(c => c.name === cat)?.emoji || '📦');
        const pct = expensesSum > 0 ? (amt / expensesSum) * 100 : 0;

        const row = document.createElement('div');
        row.className = 'category-meter';
        row.innerHTML = `
          <div class="meter-header">
            <span>${emoji} ${cat}</span>
            <strong>₹${amt.toLocaleString('en-IN')} (${pct.toFixed(1)}%)</strong>
          </div>
          <div class="meter-bg">
            <div class="meter-fill" style="width: ${pct}%; background: ${isCompanyCat ? 'var(--accent-blue)' : 'var(--accent-purple)'};"></div>
          </div>
        `;
        subContent.appendChild(row);
      });

    } else if (filterVal === 'Incoming') {
      // Breakdown of approved incoming money sources
      const sourceMap = {};
      (this.data.incoming_money || [])
        .filter(i => i.status === 'Approved')
        .forEach(i => {
          sourceMap[i.receivedFrom] = (sourceMap[i.receivedFrom] || 0) + i.amount;
        });

      const sortedSources = Object.entries(sourceMap)
        .filter(([_, amt]) => amt > 0)
        .sort((a, b) => b[1] - a[1]);

      if (sortedSources.length === 0) {
        subContent.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:0.75rem;">No approved incoming money recorded.</div>`;
        return;
      }

      sortedSources.forEach(([source, amt]) => {
        const pct = approvedIncomingSum > 0 ? (amt / approvedIncomingSum) * 100 : 0;
        const row = document.createElement('div');
        row.className = 'category-meter';
        row.innerHTML = `
          <div class="meter-header">
            <span>📥 ${source}</span>
            <strong>₹${amt.toLocaleString('en-IN')} (${pct.toFixed(1)}%)</strong>
          </div>
          <div class="meter-bg">
            <div class="meter-fill" style="width: ${pct}%; background: var(--primary);"></div>
          </div>
        `;
        subContent.appendChild(row);
      });

    } else if (filterVal === 'Sent') {
      // Breakdown of money issued to staff members
      const staffMap = {};
      this.data.transactions.forEach(t => {
        staffMap[t.staffName] = (staffMap[t.staffName] || 0) + t.amount;
      });

      const sortedStaff = Object.entries(staffMap)
        .filter(([_, amt]) => amt > 0)
        .sort((a, b) => b[1] - a[1]);

      if (sortedStaff.length === 0) {
        subContent.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:0.75rem;">No money sent to staff yet.</div>`;
        return;
      }

      sortedStaff.forEach(([name, amt]) => {
        const pct = ownerSentSum > 0 ? (amt / ownerSentSum) * 100 : 0;
        const row = document.createElement('div');
        row.className = 'category-meter';
        row.innerHTML = `
          <div class="meter-header">
            <span>👤 ${name}</span>
            <strong>₹${amt.toLocaleString('en-IN')} (${pct.toFixed(1)}%)</strong>
          </div>
          <div class="meter-bg">
            <div class="meter-fill" style="width: ${pct}%; background: var(--accent-blue);"></div>
          </div>
        `;
        subContent.appendChild(row);
      });
    }
  },

  /* ==================== FEATURE 9: OWNER/COMPANY EXPENSES ==================== */
  renderCompanyExpenses() {
    const container = document.getElementById('ownerExpensesContainer');
    container.innerHTML = '';

    const companySpends = this.data.expenses
      .filter(e => e.isOwnerExpense)
      .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

    if (companySpends.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 12px;">No company expenses logged yet.</div>`;
      return;
    }

    companySpends.forEach(exp => {
      const item = document.createElement('div');
      item.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 12px; padding: 10px; display: flex; justify-content: space-between; align-items: center;';
      
      const dt = new Date(exp.dateTime);
      const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

      item.innerHTML = `
        <div>
          <strong style="color: var(--accent-blue); font-size: 0.8rem;">🏢 ${exp.category}</strong>
          <span style="font-size: 0.65rem; color: var(--text-muted); display: block; margin-top: 1px;">
            ${dateStr} ${timeStr} • "${exp.description}"
          </span>
        </div>
        <div style="text-align: right;">
          <strong style="font-size: 0.9rem; color: var(--warning);">₹${exp.amount.toLocaleString('en-IN')}</strong>
          ${exp.pendingSync ? `<span style="font-size: 0.55rem; color: var(--warning); display: block;">Draft</span>` : ''}
        </div>
      `;
      container.appendChild(item);
    });
  },

  openAddCompanyExpenseModal() {
    document.getElementById('companyExpenseAmountInput').value = '';
    document.getElementById('companyExpenseDescInput').value = '';
    document.getElementById('companyExpenseCategorySelect').selectedIndex = 8; // Miscellaneous default
    
    document.getElementById('companyExpenseDateInput').value = new Date().toISOString().split('T')[0];
    const now = new Date();
    document.getElementById('companyExpenseTimeInput').value = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

    this.openModal('addCompanyExpenseModal');
  },

  async saveCompanyExpense(event) {
    event.preventDefault();
    const amount = parseFloat(document.getElementById('companyExpenseAmountInput').value);
    const category = document.getElementById('companyExpenseCategorySelect').value;
    const description = document.getElementById('companyExpenseDescInput').value;
    const dateVal = document.getElementById('companyExpenseDateInput').value;
    const timeVal = document.getElementById('companyExpenseTimeInput').value;

    const dateTime = `${dateVal}T${timeVal || '12:00'}:00`;

    const newCompanyExp = {
      id: newRecordId(),
      dateTime,
      category,
      amount,
      description,
      staffName: 'Owner',
      vendorName: 'Corporate',
      isOwnerExpense: true,
      paymentMethod: 'Bank',
      isSynced: this.isOnline,
      pendingSync: !this.isOnline
    };

    try {
      await window.TrailCashDB.addExpense(newCompanyExp);
      await this.syncWithServer();
      this.showToast('Company expense recorded successfully!', 'success');
      await this.refreshData();
      this.closeModal('addCompanyExpenseModal');
      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to save company expense: ' + (err.message || err), 'danger');
    }
  },

  /* ==================== OWNER: MANAGE STAFF ROSTER ==================== */
  renderManageStaff() {
    const container = document.getElementById('manageStaffContainer');
    if (!container) return;
    container.innerHTML = '';

    const staffList = this.data.staff.filter(s => s.role === 'Staff');

    if (staffList.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 12px;">No staff registered.</div>`;
      return;
    }

    staffList.forEach(s => {
      const row = document.createElement('div');
      row.className = 'staff-manage-row';

      const statusLabel = s.status === 'Active' ? 'Active' : 'Deactivated';
      const statusColor = s.status === 'Active' ? 'var(--primary)' : 'var(--text-muted)';

      row.innerHTML = `
        <div class="staff-manage-info">
          <strong style="font-size: 0.9rem;">${s.name}</strong>
          <span class="staff-manage-details">
            PIN: <span style="font-family: monospace; font-weight: bold; color: var(--warning);">${s.pin}</span> • 
            Status: <span style="color: ${statusColor}; font-weight: 600;">${statusLabel}</span>
          </span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; border-color: rgba(59, 130, 246, 0.3);" onclick="app.openEditStaff('${s.id}')">Edit</button>
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; color: var(--danger); border-color: rgba(239, 68, 68, 0.2);" onclick="app.deleteStaff('${s.id}')">Remove</button>
        </div>
      `;
      container.appendChild(row);
    });
  },

  openAddStaffModal() {
    document.getElementById('newStaffNameInput').value = '';
    document.getElementById('newStaffPinInput').value = '';
    this.openModal('addStaffModal');
  },

  async saveAddStaff(event) {
    event.preventDefault();
    const name = document.getElementById('newStaffNameInput').value.trim();
    const pin = document.getElementById('newStaffPinInput').value.trim();

    if (!/^[0-9]{4}$/.test(pin)) {
      this.showToast('PIN must be exactly 4 digits.', 'warning');
      return;
    }

    // Check duplicate
    const exists = this.data.staff.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      this.showToast(`Staff member "${name}" already exists!`, 'warning');
      return;
    }

    const newStaff = {
      id: newRecordId(),
      name,
      pin,
      role: 'Staff',
      status: 'Active'
    };

    try {
      await window.TrailCashDB.addStaff(newStaff);
      await this.syncWithServer();
      this.showToast(`Added staff member: ${name}`, 'success');
      await this.refreshData();
      this.closeModal('addStaffModal');
      
      // Update selectors
      const staffSelect = document.getElementById('filterStaffSelect');
      if (staffSelect) staffSelect.innerHTML = '<option value="">All Staff</option>';
      this.populateFilterDropdowns();

      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to add staff member: ' + (err.message || err), 'danger');
    }
  },

  openEditStaff(id) {
    const staff = this.data.staff.find(s => s.id === id);
    if (!staff) return;

    document.getElementById('editStaffId').value = staff.id;
    document.getElementById('editStaffNameInput').value = staff.name;
    document.getElementById('editStaffPinInput').value = '';

    this.openModal('editStaffModal');
  },

  async saveEditStaff(event) {
    event.preventDefault();
    const id = document.getElementById('editStaffId').value;
    const name = document.getElementById('editStaffNameInput').value.trim();
    const pin = document.getElementById('editStaffPinInput').value.trim();

    if (pin && !/^[0-9]{4}$/.test(pin)) {
      this.showToast('PIN must be exactly 4 digits when changing it.', 'warning');
      return;
    }

    const staff = this.data.staff.find(s => s.id === id);
    if (!staff) return;

    // Check duplicate if name changed
    if (name.toLowerCase() !== staff.name.toLowerCase()) {
      const exists = this.data.staff.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        this.showToast(`Staff member "${name}" already exists!`, 'warning');
        return;
      }
    }

    // Update transactions and expenses staff names for consistency
    const oldName = staff.name;
    staff.name = name;
    if (pin) staff.pin = pin;

    try {
      await window.TrailCashDB.updateStaff(staff);
      
      // Update transaction records with new name
      for (const tx of this.data.transactions) {
        if (tx.staffName === oldName) {
          tx.staffName = name;
          await window.TrailCashDB.addCashTransaction(tx);
        }
      }

      // Update expense records with new name
      for (const exp of this.data.expenses) {
        if (exp.staffName === oldName) {
          exp.staffName = name;
          await window.TrailCashDB.updateExpense(exp);
        }
      }

      await this.syncWithServer();
      this.showToast('Staff profile updated successfully.', 'success');
      await this.refreshData();
      this.closeModal('editStaffModal');

      // Update dropdowns
      const staffSelect = document.getElementById('filterStaffSelect');
      if (staffSelect) staffSelect.innerHTML = '<option value="">All Staff</option>';
      this.populateFilterDropdowns();

      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to edit staff profile: ' + (err.message || err), 'danger');
    }
  },

  async deleteStaff(id) {
    const staff = this.data.staff.find(s => s.id === id);
    if (!staff) return;

    if (confirm(`Are you sure you want to remove staff member "${staff.name}"? Historical records will be kept.`)) {
      try {
        await window.TrailCashDB.deleteStaff(id);
        await this.syncWithServer();
        this.showToast(`Staff member "${staff.name}" removed.`, 'success');
        await this.refreshData();

        // Update dropdowns
        const staffSelect = document.getElementById('filterStaffSelect');
        if (staffSelect) staffSelect.innerHTML = '<option value="">All Staff</option>';
        this.populateFilterDropdowns();

        this.updateView();
      } catch (err) {
        console.error(err);
        this.showToast('Failed to delete staff member: ' + (err.message || err), 'danger');
      }
    }
  },

  /* ==================== FEATURE 1: SEND MONEY ==================== */
  openIssueCashModal() {
    const staffSelect = document.getElementById('cashStaffSelect');
    staffSelect.innerHTML = '';
    
    this.STAFF_LIST.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name;
      staffSelect.appendChild(opt);
    });

    document.getElementById('cashAmountInput').value = '';
    document.getElementById('cashRefInput').value = '';
    document.getElementById('cashDateInput').value = new Date().toISOString().split('T')[0];
    const now = new Date();
    document.getElementById('cashTimeInput').value = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

    this.openModal('issueCashModal');
  },

  async saveIssuedCash(event) {
    event.preventDefault();
    const staffName = document.getElementById('cashStaffSelect').value;
    const amount = parseFloat(document.getElementById('cashAmountInput').value);
    const mode = document.getElementById('cashModeSelect').value;
    const refNumber = document.getElementById('cashRefInput').value;
    const dateVal = document.getElementById('cashDateInput').value;
    const timeVal = document.getElementById('cashTimeInput').value;

    if (!staffName || isNaN(amount) || amount <= 0) {
      this.showToast('Please enter valid advance details.', 'warning');
      return;
    }

    const dateTime = `${dateVal}T${timeVal || '12:00'}:00`;

    const newTx = {
      id: newRecordId(),
      dateTime,
      amount,
      mode,
      refNumber, // Remarks
      staffName,
      purpose: 'Trek Advance'
    };

    try {
      await window.TrailCashDB.addCashTransaction(newTx);
      await this.syncWithServer();
      this.showToast(`Advance advance of ₹${amount.toLocaleString('en-IN')} sent to ${staffName}!`, 'success');
      await this.refreshData();
      this.closeModal('issueCashModal');
      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to save money transfer advance: ' + (err.message || err), 'danger');
    }
  },

  /* ==================== FEATURE 2: ADD EXPENSE (STAFF) ==================== */
  openAddExpenseModal() {
    this.selectedCategory = '';
    this.tempReceiptData = null;
    
    document.getElementById('uploadPreview').style.display = 'none';
    document.getElementById('uploadIcon').style.display = 'block';
    document.getElementById('uploadText').textContent = 'Take Photo / Upload Bill Receipt';
    
    document.getElementById('expenseDateInput').value = new Date().toISOString().split('T')[0];
    const now = new Date();
    document.getElementById('expenseTimeInput').value = now.toTimeString().split(' ')[0].substring(0, 5);

    document.getElementById('otherCategoryGroup').style.display = 'none';
    document.getElementById('expenseOtherInput').value = '';
    document.getElementById('expenseOtherInput').removeAttribute('required');

    const btns = document.querySelectorAll('.category-btn');
    btns.forEach(b => b.classList.remove('active'));

    this.openModal('addExpenseModal');
  },

  renderCategoryGrid() {
    const grid = document.getElementById('categoryGrid');
    if (!grid) return;
    grid.innerHTML = '';

    CATEGORIES.forEach(cat => {
      const btn = document.createElement('div');
      btn.className = 'category-btn';
      btn.innerHTML = `
        <span class="category-icon">${cat.emoji}</span>
        <span>${cat.name}</span>
      `;
      btn.onclick = () => {
        const children = grid.querySelectorAll('.category-btn');
        children.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');

        this.selectedCategory = cat.name;
        document.getElementById('selectedCategory').value = cat.name;

        const otherGroup = document.getElementById('otherCategoryGroup');
        const otherInput = document.getElementById('expenseOtherInput');
        if (cat.name === 'Other') {
          otherGroup.style.display = 'block';
          otherInput.setAttribute('required', 'true');
          otherInput.focus();
        } else {
          otherGroup.style.display = 'none';
          otherInput.removeAttribute('required');
          otherInput.value = '';
        }
      };
      grid.appendChild(btn);
    });
  },

  triggerReceiptUpload() {
    document.getElementById('receiptFileInput').click();
  },

  handleReceiptFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.tempReceiptData = e.target.result;
      document.getElementById('uploadIcon').style.display = 'none';
      const preview = document.getElementById('uploadPreview');
      preview.src = e.target.result;
      preview.style.display = 'block';
      document.getElementById('uploadText').textContent = 'Bill Loaded successfully!';
    };
    reader.readAsDataURL(file);
  },

  simulateCameraCapture() {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, 300, 300);

    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 280, 280);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('TRAIL CASH RECEIPT', 40, 50);

    ctx.font = '12px monospace';
    ctx.fillText(`STAFF: ${this.currentUser}`, 35, 90);
    ctx.fillText(`DATE: ${new Date().toLocaleDateString('en-IN')}`, 35, 120);
    ctx.fillText(`AMT: ₹${document.getElementById('expenseAmountInput').value || '1,500'}`, 35, 155);

    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(200, 200, 40, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#059669';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('PAID IN FULL', 165, 195);
    ctx.fillText('VERIFIED', 178, 210);

    this.tempReceiptData = canvas.toDataURL('image/jpeg');

    document.getElementById('uploadIcon').style.display = 'none';
    const preview = document.getElementById('uploadPreview');
    preview.src = this.tempReceiptData;
    preview.style.display = 'block';
    document.getElementById('uploadText').textContent = 'Camera snapshot simulated!';
    this.showToast('Bill camera simulated successfully.', 'success');
  },

  skipReceiptFile() {
    this.tempReceiptData = null;
    document.getElementById('uploadPreview').style.display = 'none';
    document.getElementById('uploadIcon').style.display = 'block';
    document.getElementById('uploadText').textContent = 'No receipt bill uploaded (Skipped)';
    this.showToast('Bill photo requirement skipped.', 'warning');
  },

  fetchGpsLocation() {
    const label = document.getElementById('gpsStatus');
    const indicator = document.getElementById('gpsIndicator');
    if (!label) return;

    if (!navigator.geolocation) {
      label.textContent = '📍 GPS not supported (Remote mountains fallback)';
      this.tempGpsCoords = { latitude: 30.6974, longitude: 79.5932 };
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.tempGpsCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        };
        label.textContent = `📍 GPS: resolved (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`;
        if (indicator) indicator.classList.add('active');
      },
      () => {
        // Falling back to mountain trail coordinates (e.g. Govindghat / Ghangaria)
        this.tempGpsCoords = { latitude: 30.6974, longitude: 79.5932 };
        label.textContent = '📍 GPS: Offline (Govindghat fallback)';
        if (indicator) indicator.classList.remove('active');
      },
      { timeout: 3000 }
    );
  },

  async saveExpense(event) {
    event.preventDefault();

    if (!this.selectedCategory) {
      this.showToast('Please select a category.', 'warning');
      return;
    }

    const amount = parseFloat(document.getElementById('expenseAmountInput').value);
    const paymentMethod = document.getElementById('expensePaymentSelect').value;
    const vendorName = document.getElementById('expenseVendorInput').value;
    const description = document.getElementById('expenseDescInput').value;
    const dateVal = document.getElementById('expenseDateInput').value;
    const timeVal = document.getElementById('expenseTimeInput').value;

    let customCategory = null;
    if (this.selectedCategory === 'Other') {
      customCategory = document.getElementById('expenseOtherInput').value.trim();
    }

    // Verify balance for staff
    const stats = this.getStaffBalances(this.currentUser);
    if (amount > stats.balance) {
      if (!confirm(`Warning: This expense exceeds your available balance of ₹${stats.balance}. Do you still want to log it?`)) {
        return;
      }
    }

    const dateTime = `${dateVal}T${timeVal || '12:00'}:00`;

    const newExpense = {
      id: newRecordId(),
      dateTime,
      staffName: this.currentUser,
      category: this.selectedCategory,
      customCategory,
      amount,
      paymentMethod,
      vendorName,
      description,
      receiptPhoto: this.tempReceiptData,
      gpsLocation: this.tempGpsCoords,
      isOwnerExpense: false,
      isSynced: this.isOnline,
      pendingSync: !this.isOnline
    };

    try {
      await window.TrailCashDB.addExpense(newExpense);
      
      await this.syncWithServer();
      await this.refreshData();
      
      if (this.isOnline) {
        this.showToast('Expense saved and synced!', 'success');
      } else {
        this.showToast('Offline! Saved locally to draft cache.', 'warning');
      }

      this.closeModal('addExpenseModal');
      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to save expense: ' + (err.message || err), 'danger');
    }
  },

  /* ==================== FEATURE: ADD INCOMING MONEY ==================== */
  openAddIncomingMoneyModal() {
    this.tempIncomingProofData = null;
    document.getElementById('incomingUploadPreview').style.display = 'none';
    document.getElementById('incomingUploadIcon').style.display = 'block';
    document.getElementById('incomingUploadText').textContent = 'Upload Payment Proof / Screenshot';
    
    document.getElementById('incomingDateInput').value = new Date().toISOString().split('T')[0];
    const now = new Date();
    document.getElementById('incomingTimeInput').value = now.toTimeString().split(' ')[0].substring(0, 5);

    document.getElementById('incomingOtherGroup').style.display = 'none';
    document.getElementById('incomingOtherInput').value = '';
    document.getElementById('incomingOtherInput').removeAttribute('required');

    document.getElementById('incomingAmountInput').value = '';
    document.getElementById('incomingNameInput').value = '';
    document.getElementById('incomingRemarksInput').value = '';
    document.getElementById('incomingReceivedFromSelect').selectedIndex = 0;
    document.getElementById('incomingPaymentSelect').selectedIndex = 0;

    this.openModal('addIncomingMoneyModal');
  },

  handleIncomingReceivedFromChange() {
    const val = document.getElementById('incomingReceivedFromSelect').value;
    const otherGroup = document.getElementById('incomingOtherGroup');
    const otherInput = document.getElementById('incomingOtherInput');
    if (val === 'Other') {
      otherGroup.style.display = 'block';
      otherInput.setAttribute('required', 'true');
      otherInput.focus();
    } else {
      otherGroup.style.display = 'none';
      otherInput.removeAttribute('required');
      otherInput.value = '';
    }
  },

  triggerIncomingProofUpload() {
    document.getElementById('incomingProofFileInput').click();
  },

  handleIncomingProofSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.tempIncomingProofData = e.target.result;
      document.getElementById('incomingUploadIcon').style.display = 'none';
      const preview = document.getElementById('incomingUploadPreview');
      preview.src = this.tempIncomingProofData;
      preview.style.display = 'block';
      document.getElementById('incomingUploadText').textContent = file.name;
      this.showToast('Payment proof uploaded successfully.', 'success');
    };
    reader.readAsDataURL(file);
  },

  simulateIncomingProofCapture() {
    // Generate simulated payment proof screenshot
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 400, 400);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('INCOMING PAYMENT PROOF', 40, 50);

    ctx.font = '12px monospace';
    ctx.fillText(`STAFF: ${this.currentUser}`, 35, 90);
    ctx.fillText(`DATE: ${new Date().toLocaleDateString('en-IN')}`, 35, 120);
    ctx.fillText(`FROM: ${document.getElementById('incomingNameInput').value || 'Customer'}`, 35, 140);
    ctx.fillText(`AMT: ₹${document.getElementById('incomingAmountInput').value || '2,000'}`, 35, 170);

    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(200, 250, 40, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#059669';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('SUCCESSFUL', 170, 245);
    ctx.fillText('BANK VERIFIED', 160, 260);

    this.tempIncomingProofData = canvas.toDataURL('image/jpeg');

    document.getElementById('incomingUploadIcon').style.display = 'none';
    const preview = document.getElementById('incomingUploadPreview');
    preview.src = this.tempIncomingProofData;
    preview.style.display = 'block';
    document.getElementById('incomingUploadText').textContent = 'Simulated screenshot generated!';
    this.showToast('Payment proof screenshot simulated successfully.', 'success');
  },

  clearIncomingProof() {
    this.tempIncomingProofData = null;
    document.getElementById('incomingUploadPreview').style.display = 'none';
    document.getElementById('incomingUploadIcon').style.display = 'block';
    document.getElementById('incomingUploadText').textContent = 'Upload Payment Proof / Screenshot';
    this.showToast('Payment proof removed.', 'warning');
  },

  async saveIncomingMoney(event) {
    event.preventDefault();

    const amount = parseFloat(document.getElementById('incomingAmountInput').value);
    const receivedFromVal = document.getElementById('incomingReceivedFromSelect').value;
    const customReceivedFrom = document.getElementById('incomingOtherInput').value.trim();
    const name = document.getElementById('incomingNameInput').value.trim();
    const paymentMethod = document.getElementById('incomingPaymentSelect').value;
    const remarks = document.getElementById('incomingRemarksInput').value.trim();
    const dateVal = document.getElementById('incomingDateInput').value;
    const timeVal = document.getElementById('incomingTimeInput').value;

    if (isNaN(amount) || amount <= 0) {
      this.showToast('Please enter a valid amount.', 'warning');
      return;
    }

    const finalReceivedFrom = receivedFromVal === 'Other' ? customReceivedFrom : receivedFromVal;
    const dateTime = `${dateVal}T${timeVal || '12:00'}:00`;

    const newRecord = {
      id: newRecordId(),
      dateTime,
      amount,
      receivedFrom: finalReceivedFrom,
      receivedFromCategory: receivedFromVal,
      customReceivedFrom: receivedFromVal === 'Other' ? customReceivedFrom : null,
      name,
      paymentMethod,
      remarks,
      proofPhoto: this.tempIncomingProofData,
      status: 'Pending Approval',
      createdBy: this.currentUser,
      createdAt: new Date().toISOString(),
      reviewedBy: null,
      reviewedAt: null,
      comment: null
    };

    try {
      await window.TrailCashDB.addIncomingMoney(newRecord);
      this.showToast('Incoming money saved as Pending Approval!', 'success');
      
      await this.syncWithServer();
      await this.refreshData();

      this.closeModal('addIncomingMoneyModal');
      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to save incoming money: ' + (err.message || err), 'danger');
    }
  },

  async approveIncomingMoney(id, comment) {
    const record = this.data.incoming_money.find(i => i.id === id);
    if (!record) return;

    record.status = 'Approved';
    record.reviewedBy = this.currentUser;
    record.reviewedAt = new Date().toISOString();
    record.comment = comment || null;

    try {
      await window.TrailCashDB.updateIncomingMoney(record);
      this.showToast('Transaction approved!', 'success');

      await this.syncWithServer();
      await this.refreshData();
      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to approve transaction: ' + (err.message || err), 'danger');
    }
  },

  async rejectIncomingMoney(id, comment) {
    const record = this.data.incoming_money.find(i => i.id === id);
    if (!record) return;

    record.status = 'Rejected';
    record.reviewedBy = this.currentUser;
    record.reviewedAt = new Date().toISOString();
    record.comment = comment || null;

    try {
      await window.TrailCashDB.updateIncomingMoney(record);
      this.showToast('Transaction rejected.', 'warning');

      await this.syncWithServer();
      await this.refreshData();
      this.updateView();
    } catch (err) {
      console.error(err);
      this.showToast('Failed to reject transaction: ' + (err.message || err), 'danger');
    }
  },

  /* ==================== FEATURE 10: RESET ALL DATA ==================== */
  async resetAllSystemData() {
    if (confirm('Are you sure you want to RESET all data? This deletes all transactions, expenses, bills, and balances, keeping ONLY the staff roster list. This action cannot be undone.')) {
      try {
        await window.TrailCashDB.resetAllData();
        this.showToast('All transaction and expense data wiped successfully.', 'success');
        
        await this.refreshData();
        this.clearOwnerFilters();
        this.updateView();
      } catch (err) {
        console.error(err);
        this.showToast('Failed to reset system data: ' + (err.message || err), 'danger');
      }
    }
  },

  /* ==================== FEATURE 7: RECEIPT BILLS DETAILS ==================== */
  viewReceipt(expenseId) {
    const exp = this.data.expenses.find(e => e.id === expenseId);
    if (!exp) return;

    const container = document.getElementById('receiptPaperContainer');
    const deleteBtn = document.getElementById('receiptDeleteBtn');

    // Only allow deletion of unsynced draft offline expenses by the staff author
    if (exp.staffName === this.currentUser && exp.pendingSync) {
      deleteBtn.style.display = 'block';
      deleteBtn.onclick = () => this.deleteDraftExpense(exp.id);
    } else {
      deleteBtn.style.display = 'none';
    }

    const formattedDate = new Date(exp.dateTime).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const catLabel = exp.customCategory ? `${exp.category} (${exp.customCategory})` : exp.category;
    const authorLabel = exp.isOwnerExpense ? 'Company Corporate' : exp.staffName;

    let html = `
      <div class="receipt-title">
        ${(exp.vendorName || 'TRAIL OUTPOST').toUpperCase()}<br>
        <span style="font-size: 0.65rem; font-weight: normal; color: var(--text-muted);">FIELD EXPENSE LOG</span>
      </div>
      
      <div class="receipt-row">
        <span>DATE:</span>
        <span>${formattedDate}</span>
      </div>
      <div class="receipt-row">
        <span>LOGGED BY:</span>
        <span>${authorLabel.toUpperCase()}</span>
      </div>
      
      <div style="border-bottom: 1px dashed #94a3b8; margin: 4px 0;"></div>
      
      <div class="receipt-row" style="font-weight: bold; margin-bottom: 2px;">
        <span>ITEM / CATEGORY</span>
        <span>AMOUNT</span>
      </div>
      
      <div class="receipt-row">
        <span>${catLabel} - ${exp.description}</span>
        <span>₹${exp.amount.toLocaleString('en-IN')}.00</span>
      </div>

      <div style="border-bottom: 1px dashed #94a3b8; margin: 8px 0 4px 0;"></div>

      <div class="receipt-row total">
        <span>TOTAL:</span>
        <span>₹${exp.amount.toLocaleString('en-IN')}.00</span>
      </div>

      <div class="receipt-row">
        <span>METHOD:</span>
        <span>${(exp.paymentMethod || 'Cash').toUpperCase()}</span>
      </div>
    `;

    if (exp.receiptPhoto) {
      html += `
        <div style="border-top: 1px dashed #94a3b8; padding-top: 10px; margin-top: 10px; text-align: center;">
          <span style="font-size: 0.65rem; font-weight: bold; color: var(--text-muted);">SCANNED RECEIPT:</span>
          <img style="width: 100%; border-radius: 6px; margin-top: 6px; max-height: 180px; object-fit: contain;" src="${exp.receiptPhoto}" alt="Receipt Bill Photo">
        </div>
      `;
    }

    const stampText = exp.receiptPhoto ? 'BILL VERIFIED' : 'NO BILL ATTACHED';
    const stampColor = exp.receiptPhoto ? '#059669' : '#dc2626';

    html += `
      <div class="receipt-stamp" style="border-color: ${stampColor}; color: ${stampColor};">
        ${stampText}
      </div>
    `;

    container.innerHTML = html;
    this.openModal('viewReceiptModal');
  },

  async deleteDraftExpense(id) {
    if (confirm('Are you sure you want to delete this unsynced expense draft?')) {
      try {
        await window.TrailCashDB.deleteExpense(id);
        this.showToast('Draft expense deleted.', 'success');
        await this.refreshData();
        this.closeModal('viewReceiptModal');
        this.updateView();
      } catch (err) {
        console.error(err);
        this.showToast('Failed to delete draft: ' + (err.message || err), 'danger');
      }
    }
  },

  /* ==================== FEATURE 11: CSV EXPORTS ==================== */
  exportToCSV() {
    let csv = 'Type,Date,Staff/Source,Category,Description,Amount,Payment Method,Vendor\n';
    
    // Append transactions
    this.data.transactions.forEach(tx => {
      const date = tx.dateTime.split('T')[0];
      const desc = (tx.refNumber || 'Trek Advance').replace(/"/g, '""');
      csv += `Advance,${date},${tx.staffName},Advance,"${desc}",${tx.amount},${tx.mode},-\n`;
    });

    // Append expenses
    this.data.expenses.forEach(e => {
      const date = e.dateTime.split('T')[0];
      const desc = e.description.replace(/"/g, '""');
      const staff = e.isOwnerExpense ? 'Company' : e.staffName;
      const cat = e.customCategory ? `${e.category} (${e.customCategory})` : e.category;
      csv += `Expense,${date},${staff},${cat},"${desc}",${e.amount},${e.paymentMethod || 'Cash'},${e.vendorName || '-'}\n`;
    });

    this.downloadFile(csv, 'trailcash_company_report.csv', 'text/csv');
    this.showToast('Company reports exported to Excel CSV!', 'success');
  },

  exportStaffLedgerCSV() {
    const name = this.activeStaffProfileName;
    let csv = `Passbook Ledger for ${name}\n`;
    csv += 'Date,Type,Details,Amount,Running Balance\n';

    const advances = this.data.transactions
      .filter(t => t.staffName === name)
      .map(t => ({ ...t, passType: 'credit' }));

    const spends = this.data.expenses
      .filter(e => e.staffName === name && !e.isOwnerExpense)
      .map(e => ({ ...e, passType: 'debit' }));

    const unified = [...advances, ...spends].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

    let runningBal = 0;
    csv += '-,Opening Balance,-,0,0\n';

    unified.forEach(item => {
      const date = item.dateTime.split('T')[0];
      if (item.passType === 'credit') {
        runningBal += item.amount;
        csv += `${date},Credit,Received Advance,${item.amount},${runningBal}\n`;
      } else {
        runningBal -= item.amount;
        const details = `${item.category} - ${item.description}`.replace(/"/g, '""');
        csv += `${date},Debit,"${details}",-${item.amount},${runningBal}\n`;
      }
    });

    this.downloadFile(csv, `trailcash_ledger_${name.toLowerCase()}.csv`, 'text/csv');
    this.showToast(`${name}'s passbook exported to Excel CSV!`, 'success');
  },

  downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  /* ==================== FEATURE 11: PDF EXPORTS (PRINT) ==================== */
  exportToPDF() {
    this.showToast('Opening print dialog. Set printer to "Save as PDF".', 'success');
    window.print();
  },

  exportStaffLedgerPDF() {
    this.showToast('Printing staff passbook ledger. Set printer to "Save as PDF".', 'success');
    window.print();
  },

  /* ==================== DIALOG UTILITIES ==================== */
  openModal(id) {
    document.getElementById(id).classList.add('active');
  },

  closeModal(id) {
    document.getElementById(id).classList.remove('active');
  },

  showToast(message, type = 'success') {
    const toast = document.getElementById('toastAlert');
    const msg = document.getElementById('toastMessage');
    const icon = document.getElementById('toastIcon');
    if (!toast || !msg || !icon) return;

    msg.textContent = message;
    
    if (type === 'success') {
      toast.className = 'toast active';
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 16 14"/></svg>`;
    } else if (type === 'warning') {
      toast.className = 'toast active warning';
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else {
      toast.className = 'toast active warning';
      toast.style.borderColor = 'var(--danger)';
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    }

    setTimeout(() => {
      toast.classList.remove('active');
      toast.style.borderColor = '';
    }, 3500);
  }
};

window.app = app;

window.addEventListener('DOMContentLoaded', () => {
  app.init();
});

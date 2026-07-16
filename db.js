// db.js - Supabase & IndexedDB Sync Layer for TrailCash

const DB_NAME = 'TrailCashDB';
const DB_VERSION = 7;

let dbInstance = null;
let useInMemoryFallback = false;
let supabase = null;

// Default Seed Data
const DEFAULT_STAFF = [
  { id: 'staff-rishabh', name: 'Rishabh', pin: '1111', role: 'Owner', status: 'Active' },
  { id: 'staff-shubham', name: 'Shubham', pin: '1234', role: 'Staff', status: 'Active' },
  { id: 'staff-devraj', name: 'Devraj', pin: '1234', role: 'Staff', status: 'Active' },
  { id: 'staff-yash', name: 'Yash', pin: '1234', role: 'Staff', status: 'Active' },
  { id: 'staff-yashpal', name: 'Yashpal', pin: '1234', role: 'Staff', status: 'Active' },
  { id: 'staff-mayank', name: 'Mayank', pin: '1234', role: 'Staff', status: 'Active' },
  { id: 'staff-upendra', name: 'Upendra', pin: '1234', role: 'Staff', status: 'Active' },
  { id: 'staff-bonus', name: 'Bonus', pin: '1234', role: 'Staff', status: 'Active' }
];

const inMemoryData = {
  cash_transactions: [],
  expenses: [],
  staff: [...DEFAULT_STAFF],
  notes: [],
  incoming_money: []
};

// Initialize Supabase Client dynamically
async function initSupabase() {
  if (supabase) return supabase;
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.supabaseUrl && config.supabaseAnonKey) {
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      window.supabaseInstance = supabase; // Expose globally for app.js
      console.log('Supabase initialized successfully.');
    } else {
      console.warn('Supabase URL/Key missing. Local offline mode enabled.');
    }
  } catch (err) {
    console.error('Failed to query api config:', err);
  }
  return supabase;
}

function isOnline() {
  return navigator.onLine && supabase !== null;
}

async function uploadBase64ToStorage(base64Data, filename) {
  if (!supabase) return null;
  try {
    const parts = base64Data.split(';base64,');
    if (parts.length < 2) return null;
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    const blob = new Blob([uInt8Array], { type: contentType });

    const { data, error } = await supabase.storage
      .from('trailcash-proofs')
      .upload(filename, blob, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Supabase Storage upload error:', error);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('trailcash-proofs')
      .getPublicUrl(filename);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Storage upload error:', err);
    return null;
  }
}

function getDB() {
  if (useInMemoryFallback) return Promise.resolve(null);
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.warn('IndexedDB timed out. Using memory fallback.');
      useInMemoryFallback = true;
      resolve(null);
    }, 1200);

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('cash_transactions')) {
        db.createObjectStore('cash_transactions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        db.createObjectStore('expenses', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('staff')) {
        db.createObjectStore('staff', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('incoming_money')) {
        db.createObjectStore('incoming_money', { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => {
      clearTimeout(timeoutId);
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    request.onerror = () => {
      clearTimeout(timeoutId);
      useInMemoryFallback = true;
      resolve(null);
    };
  });
}

function runTx(storeName, mode, callback) {
  return getDB().then((db) => {
    if (useInMemoryFallback || !db) return Promise.reject(new Error('IndexedDB offline'));
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = callback(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = (e) => reject(e.target.error);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function prom(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Data Mapping Utilities
function fromSupabaseTx(row) {
  return {
    id: row.id,
    dateTime: row.date_time,
    amount: parseFloat(row.amount),
    mode: row.mode,
    refNumber: row.ref_number || '',
    staffName: row.staff_name,
    purpose: row.purpose || '',
    company_id: row.company_id
  };
}

function toSupabaseTx(tx) {
  return {
    id: tx.id,
    date_time: tx.dateTime,
    amount: parseFloat(tx.amount),
    mode: tx.mode,
    ref_number: tx.refNumber || null,
    staff_name: tx.staffName,
    purpose: tx.purpose || null,
    company_id: tx.company_id || 'sar-outdoors'
  };
}

function fromSupabaseExp(row) {
  return {
    id: row.id,
    dateTime: row.date_time,
    staffName: row.staff_name,
    category: row.category,
    customCategory: row.custom_category || '',
    amount: parseFloat(row.amount),
    paymentMethod: row.payment_method,
    vendorName: row.vendor_name || '',
    description: row.description,
    receiptPhoto: row.receipt_photo_url || '',
    gpsLocation: row.gps_location || null,
    isOwnerExpense: row.is_owner_expense,
    company_id: row.company_id
  };
}

// GPS fallback mapper helper
function toSupabaseExp(exp) {
  let latLng = null;
  if (exp.gpsLocation && typeof exp.gpsLocation === 'object') {
    latLng = { latitude: exp.gpsLocation.latitude, longitude: exp.gpsLocation.longitude };
  }
  return {
    id: exp.id,
    date_time: exp.dateTime,
    staff_name: exp.staffName,
    category: exp.category,
    custom_category: exp.customCategory || null,
    amount: parseFloat(exp.amount),
    payment_method: exp.paymentMethod,
    vendor_name: exp.vendorName || null,
    description: exp.description,
    receipt_photo_url: exp.receiptPhoto || null,
    gps_location: latLng,
    is_owner_expense: !!exp.isOwnerExpense,
    company_id: exp.company_id || 'sar-outdoors'
  };
}

function fromSupabaseInc(row) {
  return {
    id: row.id,
    dateTime: row.date_time,
    amount: parseFloat(row.amount),
    receivedFrom: row.received_from,
    receivedFromCategory: row.received_from_category || '',
    customReceivedFrom: row.custom_received_from || '',
    name: row.name || '',
    paymentMethod: row.payment_method,
    remarks: row.remarks || '',
    proofPhoto: row.proof_photo_url || '',
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by || '',
    reviewedAt: row.reviewed_at || '',
    comment: row.comment || '',
    company_id: row.company_id
  };
}

function toSupabaseInc(inc) {
  return {
    id: inc.id,
    date_time: inc.dateTime,
    amount: parseFloat(inc.amount),
    received_from: inc.receivedFrom,
    received_from_category: inc.receivedFromCategory || null,
    custom_received_from: inc.customReceivedFrom || null,
    name: inc.name || null,
    payment_method: inc.paymentMethod,
    remarks: inc.remarks || null,
    proof_photo_url: inc.proofPhoto || null,
    status: inc.status || 'Pending Approval',
    created_by: inc.createdBy,
    created_at: inc.createdAt || new Date().toISOString(),
    reviewed_by: inc.reviewedBy || null,
    reviewed_at: inc.reviewedAt || null,
    comment: inc.comment || null,
    company_id: inc.company_id || 'sar-outdoors'
  };
}

const db = {
  // Cash Transactions
  async getCashTransactions() {
    if (isOnline()) {
      try {
        const { data, error } = await supabase
          .from('money_transfers')
          .select('*')
          .order('date_time', { ascending: true });
        if (!error && data) {
          const mapped = data.map(fromSupabaseTx);
          // Update cache
          await this.overwriteLocalStore('cash_transactions', mapped);
          return mapped;
        }
      } catch (err) {
        console.warn('Fetch transfers failed. Using cache.', err);
      }
    }
    if (useInMemoryFallback) return inMemoryData.cash_transactions;
    return runTx('cash_transactions', 'readonly', (store) => prom(store.getAll())).catch(() => inMemoryData.cash_transactions);
  },

  async addCashTransaction(tx) {
    tx.pendingSync = !isOnline();
    if (useInMemoryFallback) {
      inMemoryData.cash_transactions.push(tx);
    } else {
      await runTx('cash_transactions', 'readwrite', (store) => prom(store.put(tx)));
    }

    if (isOnline()) {
      try {
        const { error } = await supabase.from('money_transfers').upsert(toSupabaseTx(tx));
        if (!error) {
          tx.pendingSync = false;
          if (!useInMemoryFallback) {
            await runTx('cash_transactions', 'readwrite', (store) => prom(store.put(tx)));
          }
        }
      } catch (err) {
        console.error('Supabase transfer insertion error:', err);
      }
    }
    return tx;
  },

  // Expenses
  async getExpenses() {
    if (isOnline()) {
      try {
        const { data, error } = await supabase
          .from('expenses')
          .select('*')
          .order('date_time', { ascending: true });
        if (!error && data) {
          const mapped = data.map(fromSupabaseExp);
          await this.overwriteLocalStore('expenses', mapped);
          return mapped;
        }
      } catch (err) {
        console.warn('Fetch expenses failed. Using cache.', err);
      }
    }
    if (useInMemoryFallback) return inMemoryData.expenses;
    return runTx('expenses', 'readonly', (store) => prom(store.getAll())).catch(() => inMemoryData.expenses);
  },
  async addExpense(expense) {
    expense.pendingSync = !isOnline();
    if (useInMemoryFallback) {
      inMemoryData.expenses.push(expense);
    } else {
      await runTx('expenses', 'readwrite', (store) => prom(store.put(expense)));
    }

    if (isOnline()) {
      try {
        if (expense.receiptPhoto && expense.receiptPhoto.startsWith('data:')) {
          const ext = expense.receiptPhoto.includes('image/png') ? 'png' : 'jpg';
          const filename = `expense-${expense.id}-${Date.now()}.${ext}`;
          const publicUrl = await uploadBase64ToStorage(expense.receiptPhoto, filename);
          if (publicUrl) {
            expense.receiptPhoto = publicUrl;
          }
        }

        const { error } = await supabase.from('expenses').upsert(toSupabaseExp(expense));
        if (!error) {
          expense.pendingSync = false;
          if (!useInMemoryFallback) {
            await runTx('expenses', 'readwrite', (store) => prom(store.put(expense)));
          }
        }
      } catch (err) {
        console.error('Supabase expense insertion error:', err);
      }
    }
    return expense;
  },

  async updateExpense(expense) {
    return this.addExpense(expense);
  },

  async deleteExpense(id) {
    if (useInMemoryFallback) {
      inMemoryData.expenses = inMemoryData.expenses.filter(e => e.id !== id);
    } else {
      await runTx('expenses', 'readwrite', (store) => prom(store.delete(id)));
    }

    if (isOnline()) {
      try {
        await supabase.from('expenses').delete().eq('id', id);
      } catch (err) {
        console.error('Supabase expense deletion error:', err);
      }
    }
    return id;
  },

  // Staff registry
  async getStaff() {
    if (isOnline()) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('name', { ascending: true });
        if (!error && data) {
          await this.overwriteLocalStore('staff', data);
          return data;
        }
      } catch (err) {
        console.warn('Fetch staff failed. Using cache.', err);
      }
    }
    if (useInMemoryFallback) return inMemoryData.staff;
    return runTx('staff', 'readonly', (store) => prom(store.getAll())).catch(() => inMemoryData.staff);
  },

  async addStaff(staffMember) {
    if (useInMemoryFallback) {
      inMemoryData.staff.push(staffMember);
    } else {
      await runTx('staff', 'readwrite', (store) => prom(store.put(staffMember)));
    }

    if (isOnline()) {
      try {
        // Build password using PIN
        const email = `${staffMember.name.toLowerCase()}@saroutdoors.com`;
        const password = `saroutdoors-pin${staffMember.pin}`;
        
        const { data, error } = await supabase.auth.signUp({ email, password });
        const userId = data?.user?.id || staffMember.id;
        
        const profile = {
          id: userId,
          name: staffMember.name,
          role: staffMember.role,
          pin: staffMember.pin,
          company_id: 'sar-outdoors',
          status: staffMember.status || 'Active'
        };

        const { error: dbErr } = await supabase.from('profiles').upsert(profile);
        if (dbErr) console.error('Error writing profile to Supabase:', dbErr);
      } catch (err) {
        console.error('Supabase staff registry error:', err);
      }
    }
    return staffMember;
  },

  async updateStaff(staffMember) {
    return this.addStaff(staffMember);
  },

  async deleteStaff(id) {
    if (useInMemoryFallback) {
      inMemoryData.staff = inMemoryData.staff.filter(s => s.id !== id);
    } else {
      await runTx('staff', 'readwrite', (store) => prom(store.delete(id)));
    }

    if (isOnline()) {
      try {
        await supabase.from('profiles').delete().eq('id', id);
      } catch (err) {
        console.error('Supabase staff delete error:', err);
      }
    }
    return id;
  },

  // Notes updates
  async getNotes() {
    if (isOnline()) {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data) {
          const mapped = data.map(fromSupabaseInc); // reusing mapper for date properties if needed or similar
          const simplified = data.map(n => ({
            id: n.id,
            title: n.title,
            content: n.content,
            createdBy: n.created_by,
            createdAt: n.created_at,
            company_id: n.company_id
          }));
          await this.overwriteLocalStore('notes', simplified);
          return simplified;
        }
      } catch (err) {
        console.warn('Fetch notes failed. Using cache.', err);
      }
    }
    if (useInMemoryFallback) return inMemoryData.notes;
    return runTx('notes', 'readonly', (store) => prom(store.getAll())).catch(() => inMemoryData.notes);
  },

  async addNote(note) {
    if (useInMemoryFallback) {
      inMemoryData.notes.push(note);
    } else {
      await runTx('notes', 'readwrite', (store) => prom(store.put(note)));
    }

    if (isOnline()) {
      try {
        const dbNote = {
          id: note.id,
          title: note.title,
          content: note.content,
          created_by: note.createdBy,
          created_at: note.createdAt || new Date().toISOString(),
          company_id: 'sar-outdoors'
        };
        await supabase.from('notes').upsert(dbNote);
      } catch (err) {
        console.error('Supabase note write error:', err);
      }
    }
    return note;
  },

  async deleteNote(id) {
    if (useInMemoryFallback) {
      inMemoryData.notes = inMemoryData.notes.filter(n => n.id !== id);
    } else {
      await runTx('notes', 'readwrite', (store) => prom(store.delete(id)));
    }

    if (isOnline()) {
      try {
        await supabase.from('notes').delete().eq('id', id);
      } catch (err) {
        console.error('Supabase note delete error:', err);
      }
    }
    return id;
  },

  // Incoming Money
  async getIncomingMoney() {
    if (isOnline()) {
      try {
        const { data, error } = await supabase
          .from('incoming_money')
          .select('*')
          .order('date_time', { ascending: true });
        if (!error && data) {
          const mapped = data.map(fromSupabaseInc);
          await this.overwriteLocalStore('incoming_money', mapped);
          return mapped;
        }
      } catch (err) {
        console.warn('Fetch incoming money failed. Using cache.', err);
      }
    }
    if (useInMemoryFallback) return inMemoryData.incoming_money || [];
    return runTx('incoming_money', 'readonly', (store) => prom(store.getAll())).catch(() => inMemoryData.incoming_money || []);
  },
  async addIncomingMoney(record) {
    record.pendingSync = !isOnline();
    if (useInMemoryFallback) {
      if (!inMemoryData.incoming_money) inMemoryData.incoming_money = [];
      inMemoryData.incoming_money.push(record);
    } else {
      await runTx('incoming_money', 'readwrite', (store) => prom(store.put(record)));
    }

    if (isOnline()) {
      try {
        if (record.proofPhoto && record.proofPhoto.startsWith('data:')) {
          const ext = record.proofPhoto.includes('image/png') ? 'png' : 'jpg';
          const filename = `incoming-${record.id}-${Date.now()}.${ext}`;
          const publicUrl = await uploadBase64ToStorage(record.proofPhoto, filename);
          if (publicUrl) {
            record.proofPhoto = publicUrl;
          }
        }

        const { error } = await supabase.from('incoming_money').upsert(toSupabaseInc(record));
        if (!error) {
          record.pendingSync = false;
          if (!useInMemoryFallback) {
            await runTx('incoming_money', 'readwrite', (store) => prom(store.put(record)));
          }
        }
      } catch (err) {
        console.error('Supabase incoming money write error:', err);
      }
    }
    return record;
  },

  async updateIncomingMoney(record) {
    return this.addIncomingMoney(record);
  },

  async deleteIncomingMoney(id) {
    if (useInMemoryFallback) {
      inMemoryData.incoming_money = (inMemoryData.incoming_money || []).filter(i => i.id !== id);
    } else {
      await runTx('incoming_money', 'readwrite', (store) => prom(store.delete(id)));
    }

    if (isOnline()) {
      try {
        await supabase.from('incoming_money').delete().eq('id', id);
      } catch (err) {
        console.error('Supabase incoming money delete error:', err);
      }
    }
    return id;
  },

  // Cache Overwrite Helper
  async overwriteLocalStore(storeName, dataList) {
    if (useInMemoryFallback) {
      inMemoryData[storeName] = [...dataList];
      return;
    }
    try {
      await runTx(storeName, 'readwrite', (store) => {
        store.clear();
        dataList.forEach(item => store.put(item));
      });
    } catch (e) {
      console.warn(`Local cache overwrite failed for ${storeName}:`, e);
    }
  },

  // Full clean reset (Owner Settings operation)
  async resetAllData() {
    if (isOnline()) {
      try {
        await supabase.from('money_transfers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('incoming_money').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('notes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      } catch (err) {
        console.error('Supabase server reset data error:', err);
      }
    }
    inMemoryData.cash_transactions = [];
    inMemoryData.expenses = [];
    inMemoryData.notes = [];
    inMemoryData.incoming_money = [];

    if (!useInMemoryFallback) {
      await Promise.all([
        runTx('cash_transactions', 'readwrite', (store) => prom(store.clear())),
        runTx('expenses', 'readwrite', (store) => prom(store.clear())),
        runTx('notes', 'readwrite', (store) => prom(store.clear())),
        runTx('incoming_money', 'readwrite', (store) => prom(store.clear()))
      ]).catch(e => console.warn('IndexedDB reset clear error:', e));
    }
  },

  // Overwrite entire dataset (called when restoring state or importing)
  async overwriteAllLocalData(staffList, txList, expList, incomingList = []) {
    if (isOnline()) {
      try {
        // Upload bulk to Supabase
        for (const s of staffList) {
          const profile = {
            id: s.id,
            name: s.name,
            role: s.role,
            pin: s.pin,
            company_id: 'sar-outdoors',
            status: s.status || 'Active'
          };
          await supabase.from('profiles').upsert(profile);
        }
        for (const t of txList) {
          await supabase.from('money_transfers').upsert(toSupabaseTx(t));
        }
        for (const e of expList) {
          await supabase.from('expenses').upsert(toSupabaseExp(e));
        }
        for (const i of incomingList) {
          await supabase.from('incoming_money').upsert(toSupabaseInc(i));
        }
      } catch (err) {
        console.error('Overwrite Supabase restore failed:', err);
      }
    }

    inMemoryData.staff = [...staffList];
    inMemoryData.cash_transactions = [...txList];
    inMemoryData.expenses = [...expList];
    inMemoryData.incoming_money = [...incomingList];

    if (!useInMemoryFallback) {
      await Promise.all([
        runTx('staff', 'readwrite', (store) => {
          store.clear();
          staffList.forEach(s => store.put(s));
        }),
        runTx('cash_transactions', 'readwrite', (store) => {
          store.clear();
          txList.forEach(t => store.put(t));
        }),
        runTx('expenses', 'readwrite', (store) => {
          store.clear();
          expList.forEach(e => store.put(e));
        }),
        runTx('incoming_money', 'readwrite', (store) => {
          store.clear();
          incomingList.forEach(i => store.put(i));
        })
      ]).catch(e => console.warn('IndexedDB bulk write error:', e));
    }
  },

  async syncOfflineQueue() {
    if (!isOnline()) return;
    try {
      // 1. Sync Cash Transfers
      const localTxs = useInMemoryFallback ? inMemoryData.cash_transactions : await runTx('cash_transactions', 'readonly', (store) => prom(store.getAll()));
      const pendingTxs = localTxs.filter(t => t.pendingSync);
      for (const t of pendingTxs) {
        const { error } = await supabase.from('money_transfers').upsert(toSupabaseTx(t));
        if (!error) {
          t.pendingSync = false;
          if (!useInMemoryFallback) await runTx('cash_transactions', 'readwrite', (store) => prom(store.put(t)));
        }
      }

      // 2. Sync Expenses
      const localExps = useInMemoryFallback ? inMemoryData.expenses : await runTx('expenses', 'readonly', (store) => prom(store.getAll()));
      const pendingExps = localExps.filter(e => e.pendingSync);
      for (const e of pendingExps) {
        if (e.receiptPhoto && e.receiptPhoto.startsWith('data:')) {
          const ext = e.receiptPhoto.includes('image/png') ? 'png' : 'jpg';
          const filename = `expense-${e.id}-${Date.now()}.${ext}`;
          const publicUrl = await uploadBase64ToStorage(e.receiptPhoto, filename);
          if (publicUrl) e.receiptPhoto = publicUrl;
        }
        const { error } = await supabase.from('expenses').upsert(toSupabaseExp(e));
        if (!error) {
          e.pendingSync = false;
          if (!useInMemoryFallback) await runTx('expenses', 'readwrite', (store) => prom(store.put(e)));
        }
      }

      // 3. Sync Incoming Money
      const localIncs = useInMemoryFallback ? inMemoryData.incoming_money : await runTx('incoming_money', 'readonly', (store) => prom(store.getAll()));
      const pendingIncs = (localIncs || []).filter(i => i.pendingSync);
      for (const i of pendingIncs) {
        if (i.proofPhoto && i.proofPhoto.startsWith('data:')) {
          const ext = i.proofPhoto.includes('image/png') ? 'png' : 'jpg';
          const filename = `incoming-${i.id}-${Date.now()}.${ext}`;
          const publicUrl = await uploadBase64ToStorage(i.proofPhoto, filename);
          if (publicUrl) i.proofPhoto = publicUrl;
        }
        const { error } = await supabase.from('incoming_money').upsert(toSupabaseInc(i));
        if (!error) {
          i.pendingSync = false;
          if (!useInMemoryFallback) await runTx('incoming_money', 'readwrite', (store) => prom(store.put(i)));
        }
      }

      if (pendingTxs.length > 0 || pendingExps.length > 0 || pendingIncs.length > 0) {
        console.log('Offline pending records successfully synchronized with Supabase.');
      }
    } catch (e) {
      console.error('Error during offline synchronization:', e);
    }
  },

  // Setup database connection and seed defaults if empty
  async initAndSeed() {
    await getDB();
    await initSupabase();

    // Setup network status listeners to trigger syncs
    window.addEventListener('online', () => {
      console.log('Connection restored. Running auto-sync queue...');
      this.syncOfflineQueue();
    });

    // Run a periodic sync check every 15 seconds
    setInterval(() => {
      this.syncOfflineQueue();
    }, 15000);

    try {
      // Seed default roster if table is empty
      const staffList = await this.getStaff();
      if (staffList.length === 0) {
        console.log('Seeding default profiles to database...');
        for (const s of DEFAULT_STAFF) {
          await this.addStaff(s);
        }
      }
    } catch (err) {
      console.warn('DB initialization failed:', err);
    }
  }
};

window.TrailCashDB = db;

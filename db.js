// db.js - Supabase Direct Integration for TrailCash (Sar Outdoors Enterprise)

let supabaseClient = null;

// Dynamic Translation Caches
let profilesCache = [];
let categoriesCache = [];

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

// Initialize Supabase Client dynamically
let supabaseConnected = false;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), ms);
    promise.then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function initSupabase() {
  if (supabaseClient) return supabaseClient;
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.supabaseUrl && config.supabaseAnonKey) {
      if (config.supabaseUrl.includes('your-supabase-project')) {
        console.warn('Placeholder Supabase URL detected. Operating in local offline mode.');
        return null;
      }
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      window.supabaseInstance = supabaseClient; // Expose globally for app.js
      
      // Ping database with a 2-second timeout to verify connection
      try {
        const pingPromise = supabaseClient.from('profiles').select('id').limit(1);
        const { error } = await withTimeout(pingPromise, 2000);
        if (!error) {
          supabaseConnected = true;
          console.log('Supabase initialized & verified online.');
        } else {
          console.warn('Supabase online ping returned database error:', error);
        }
      } catch (pingErr) {
        console.warn('Supabase online ping timed out or failed:', pingErr);
      }
    } else {
      console.warn('Supabase URL/Key missing. Local offline mode enabled.');
    }
  } catch (err) {
    console.error('Failed to query api config:', err);
  }
  return supabaseClient;
}

function isOnline() {
  return navigator.onLine && supabaseClient !== null && supabaseConnected;
}

async function uploadBase64ToStorage(base64Data, filename) {
  if (!supabaseClient) return null;
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

    const { data, error } = await supabaseClient.storage
      .from('expense-bills')
      .upload(filename, blob, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Supabase Storage upload error:', error);
      throw error;
    }

    return filename; // Return relative filename path
  } catch (err) {
    console.error('Storage upload error:', err);
    throw err;
  }
}

// Bulk signed URL resolver for private bucket images
async function resolveSignedUrls(rows, pathField, urlField) {
  const paths = rows.map(r => r[pathField]).filter(p => p && !p.startsWith('data:') && !p.startsWith('http'));
  if (paths.length === 0) return;

  try {
    const { data, error } = await supabaseClient.storage.from('expense-bills').createSignedUrls(paths, 60 * 60 * 2); // 2 hours
    if (!error && data) {
      rows.forEach(r => {
        const match = data.find(d => d.path === r[pathField]);
        if (match) {
          r[urlField] = match.signedUrl;
        }
      });
    }
  } catch (err) {
    console.warn('Failed to generate signed URLs:', err);
  }
}

// Cache translation refreshing
async function refreshDBCaches() {
  if (!isOnline()) return;
  try {
    const { data: pData } = await supabaseClient.from('profiles').select('*').is('deleted_at', null);
    if (pData) profilesCache = pData;
    
    const { data: cData } = await supabaseClient.from('expense_categories').select('*');
    if (cData) categoriesCache = cData;
  } catch (e) {
    console.warn('Failed to refresh dynamic caches:', e);
  }
}

// Formatting mapping helpers
function fromSupabaseTx(row) {
  const staff = profilesCache.find(p => p.id === row.staff_id);
  return {
    id: row.id,
    dateTime: row.date_time,
    amount: parseFloat(row.amount),
    mode: row.mode,
    refNumber: row.ref_number || '',
    staffName: staff ? staff.name : 'Unknown',
    purpose: row.purpose || '',
    company_id: row.company_id
  };
}

function toSupabaseTx(tx) {
  const staff = profilesCache.find(p => p.name === tx.staffName);
  return {
    id: tx.id,
    date_time: tx.dateTime,
    amount: parseFloat(tx.amount),
    mode: tx.mode,
    ref_number: tx.refNumber || null,
    staff_id: staff ? staff.id : '00000000-0000-0000-0000-000000000000', // fallback
    purpose: tx.purpose || null,
    company_id: tx.company_id || '00000000-0000-0000-0000-000000000001'
  };
}

function fromSupabaseExp(row) {
  const staff = profilesCache.find(p => p.id === row.staff_id);
  const cat = categoriesCache.find(c => c.id === row.category_id);
  return {
    id: row.id,
    dateTime: row.date_time,
    staffName: row.is_owner_expense ? 'Company' : (staff ? staff.name : 'Unknown'),
    category: cat ? cat.name : 'Other',
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

function toSupabaseExp(exp) {
  const staff = profilesCache.find(p => p.name === exp.staffName);
  const cat = categoriesCache.find(c => c.name === exp.category) || categoriesCache.find(c => c.name === 'Other');
  let latLng = null;
  if (exp.gpsLocation && typeof exp.gpsLocation === 'object') {
    latLng = { latitude: exp.gpsLocation.latitude, longitude: exp.gpsLocation.longitude };
  }
  return {
    id: exp.id,
    date_time: exp.dateTime,
    staff_id: exp.isOwnerExpense ? null : (staff ? staff.id : null),
    category_id: cat ? cat.id : '00000000-0000-0000-0000-000000000014', // default "Other"
    custom_category: exp.customCategory || null,
    amount: parseFloat(exp.amount),
    payment_method: exp.paymentMethod,
    vendor_name: exp.vendorName || null,
    description: exp.description,
    receipt_photo_url: exp.receiptPhoto || null,
    gps_location: latLng,
    is_owner_expense: !!exp.isOwnerExpense,
    company_id: exp.company_id || '00000000-0000-0000-0000-000000000001'
  };
}

function fromSupabaseInc(row) {
  const creator = profilesCache.find(p => p.id === row.created_by_id);
  const reviewer = profilesCache.find(p => p.id === row.reviewed_by_id);
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
    createdBy: creator ? creator.name : 'Unknown',
    createdAt: row.created_at,
    reviewedBy: reviewer ? reviewer.name : '',
    reviewedAt: row.reviewed_at || '',
    comment: row.comment || '',
    company_id: row.company_id
  };
}

function toSupabaseInc(inc) {
  const creator = profilesCache.find(p => p.name === inc.createdBy);
  const reviewer = profilesCache.find(p => p.name === inc.reviewedBy);
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
    created_by_id: creator ? creator.id : '00000000-0000-0000-0000-000000000000',
    created_at: inc.createdAt || new Date().toISOString(),
    reviewed_by_id: reviewer ? reviewer.id : null,
    reviewed_at: inc.reviewedAt || null,
    comment: inc.comment || null,
    company_id: inc.company_id || '00000000-0000-0000-0000-000000000001'
  };
}

const db = {
  // Cash Transactions CRUD
  async getCashTransactions() {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { data, error } = await supabaseClient
      .from('money_transfers')
      .select('*')
      .is('deleted_at', null)
      .order('date_time', { ascending: true });
    if (error) throw new Error('Failed to load transfers: ' + error.message);
    return data.map(fromSupabaseTx);
  },

  async addCashTransaction(tx) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { error } = await supabaseClient.from('money_transfers').upsert(toSupabaseTx(tx));
    if (error) throw new Error('Failed to save transfer: ' + error.message);
    return tx;
  },

  // Expenses CRUD
  async getExpenses() {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { data, error } = await supabaseClient
      .from('expenses')
      .select('*')
      .is('deleted_at', null)
      .order('date_time', { ascending: true });
    if (error) throw new Error('Failed to load expenses: ' + error.message);
    
    const mapped = data.map(fromSupabaseExp);
    await resolveSignedUrls(mapped, 'receiptPhoto', 'receiptPhoto');
    return mapped;
  },

  async addExpense(expense) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    if (expense.receiptPhoto && expense.receiptPhoto.startsWith('data:')) {
      const ext = expense.receiptPhoto.includes('image/png') ? 'png' : 'jpg';
      const filename = `expense-${expense.id}-${Date.now()}.${ext}`;
      const savedFilename = await uploadBase64ToStorage(expense.receiptPhoto, filename);
      if (savedFilename) {
        expense.receiptPhoto = savedFilename;
      }
    }

    const { error } = await supabaseClient.from('expenses').upsert(toSupabaseExp(expense));
    if (error) throw new Error('Failed to save expense: ' + error.message);

    // Resolve signed URL immediately for UI rendering
    if (expense.receiptPhoto && !expense.receiptPhoto.startsWith('data:') && !expense.receiptPhoto.startsWith('http')) {
      const { data: signedData, error: signedErr } = await supabaseClient.storage
        .from('expense-bills')
        .createSignedUrl(expense.receiptPhoto, 60 * 60 * 2);
      if (!signedErr && signedData) {
        expense.receiptPhoto = signedData.signedUrl;
      }
    }
    return expense;
  },

  async updateExpense(expense) {
    return this.addExpense(expense);
  },

  async deleteExpense(id) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { error } = await supabaseClient.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error('Failed to delete expense: ' + error.message);
    return id;
  },

  // Staff CRUD
  async getStaff() {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw new Error('Failed to load staff roster: ' + error.message);
    profilesCache = data;
    return data.map(dbProf => {
      return {
        id: dbProf.id,
        name: dbProf.name,
        role: dbProf.role,
        pin: dbProf.pin,
        status: dbProf.status,
        phone: dbProf.phone,
        email: dbProf.email
      };
    });
  },

  async addStaff(staffMember) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const email = `${staffMember.name.toLowerCase()}@saroutdoors.com`;
    const password = `saroutdoors-pin${staffMember.pin}`;
    
    // Auth Signup
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    const userId = data?.user?.id || staffMember.id;
    
    const profile = {
      id: userId,
      name: staffMember.name,
      email: email,
      phone: staffMember.phone || `+91-${staffMember.name.toLowerCase()}-${Date.now()}`,
      role: staffMember.role,
      pin: staffMember.pin,
      company_id: '00000000-0000-0000-0000-000000000001',
      status: staffMember.status || 'Active'
    };

    const { error: dbErr } = await supabaseClient.from('profiles').upsert(profile);
    if (dbErr) throw new Error('Failed to save staff profile: ' + dbErr.message);
    
    await refreshDBCaches();
    return staffMember;
  },

  async updateStaff(staffMember) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const profile = {
      id: staffMember.id,
      name: staffMember.name,
      role: staffMember.role,
      status: staffMember.status || 'Active'
    };
    if (staffMember.pin) {
      profile.pin = staffMember.pin;
    }
    const { error: dbErr } = await supabaseClient.from('profiles').upsert(profile);
    if (dbErr) throw new Error('Failed to update staff profile: ' + dbErr.message);
    await refreshDBCaches();
    return staffMember;
  },

  async deleteStaff(id) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { error } = await supabaseClient.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error('Failed to delete staff: ' + error.message);
    return id;
  },

  // Notes CRUD
  async getNotes() {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { data, error } = await supabaseClient
      .from('notes')
      .select('*, creator:profiles(name)')
      .order('created_at', { ascending: false });
    if (error) throw new Error('Failed to load notes: ' + error.message);
    
    return data.map(n => {
      return {
        id: n.id,
        title: n.title,
        content: n.content,
        createdBy: n.creator ? n.creator.name : 'Unknown',
        createdAt: n.created_at,
        company_id: n.company_id
      };
    });
  },

  async addNote(note) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const author = profilesCache.find(p => p.name === note.createdBy);
    const dbNote = {
      id: note.id,
      title: note.title,
      content: note.content,
      created_by_id: author ? author.id : '00000000-0000-0000-0000-000000000000',
      created_at: note.createdAt || new Date().toISOString(),
      company_id: '00000000-0000-0000-0000-000000000001'
    };
    const { error } = await supabaseClient.from('notes').upsert(dbNote);
    if (error) throw new Error('Failed to save note: ' + error.message);
    return note;
  },

  async deleteNote(id) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { error } = await supabaseClient.from('notes').delete().eq('id', id);
    if (error) throw new Error('Failed to delete note: ' + error.message);
    return id;
  },

  // Incoming Money CRUD
  async getIncomingMoney() {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { data, error } = await supabaseClient
      .from('incoming_money')
      .select('*')
      .is('deleted_at', null)
      .order('date_time', { ascending: true });
    if (error) throw new Error('Failed to load incoming money: ' + error.message);
    
    const mapped = data.map(fromSupabaseInc);
    await resolveSignedUrls(mapped, 'proofPhoto', 'proofPhoto');
    return mapped;
  },

  async addIncomingMoney(record) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    if (record.proofPhoto && record.proofPhoto.startsWith('data:')) {
      const ext = record.proofPhoto.includes('image/png') ? 'png' : 'jpg';
      const filename = `incoming-${record.id}-${Date.now()}.${ext}`;
      const savedFilename = await uploadBase64ToStorage(record.proofPhoto, filename);
      if (savedFilename) {
        record.proofPhoto = savedFilename;
      }
    }

    const { error } = await supabaseClient.from('incoming_money').upsert(toSupabaseInc(record));
    if (error) throw new Error('Failed to save incoming money: ' + error.message);

    // Resolve signed URL immediately for UI rendering
    if (record.proofPhoto && !record.proofPhoto.startsWith('data:') && !record.proofPhoto.startsWith('http')) {
      const { data: signedData, error: signedErr } = await supabaseClient.storage
        .from('expense-bills')
        .createSignedUrl(record.proofPhoto, 60 * 60 * 2);
      if (!signedErr && signedData) {
        record.proofPhoto = signedData.signedUrl;
      }
    }
    return record;
  },

  async updateIncomingMoney(record) {
    return this.addIncomingMoney(record);
  },

  async deleteIncomingMoney(id) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { error } = await supabaseClient.from('incoming_money').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error('Failed to delete incoming record: ' + error.message);
    return id;
  },

  // Reset database tables
  async resetAllData() {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    const { error: err1 } = await supabaseClient.from('money_transfers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error: err2 } = await supabaseClient.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error: err3 } = await supabaseClient.from('incoming_money').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error: err4 } = await supabaseClient.from('notes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (err1 || err2 || err3 || err4) throw new Error('Failed to reset database tables on Supabase.');
  },

  // Restore dataset directly to Supabase
  async overwriteAllLocalData(staffList, txList, expList, incomingList = []) {
    if (!isOnline()) throw new Error('Database is offline or disconnected.');
    try {
      for (const s of staffList) {
        const profile = {
          id: s.id,
          name: s.name,
          email: s.email || `${s.name.toLowerCase()}@saroutdoors.com`,
          phone: s.phone || `+91-${s.name.toLowerCase()}-${Date.now()}`,
          role: s.role,
          pin: s.pin,
          company_id: '00000000-0000-0000-0000-000000000001',
          status: s.status || 'Active'
        };
        await supabaseClient.from('profiles').upsert(profile);
      }
      for (const t of txList) {
        await supabaseClient.from('money_transfers').upsert(toSupabaseTx(t));
      }
      for (const e of expList) {
        await supabaseClient.from('expenses').upsert(toSupabaseExp(e));
      }
      for (const i of incomingList) {
        await supabaseClient.from('incoming_money').upsert(toSupabaseInc(i));
      }
    } catch (err) {
      throw new Error('Supabase restore failed: ' + err.message);
    }
  },

  async syncOfflineQueue() {
    // Obsolete: direct integration no-op
  },

  // Setup database connection and seed defaults if empty
  async initAndSeed() {
    await initSupabase();
    if (!isOnline()) {
      console.warn('Database is offline. Direct data connection unavailable.');
      return;
    }
    await refreshDBCaches();

    try {
      // Seed default roster if empty in database
      const staffList = await this.getStaff();
      if (staffList.length === 0) {
        console.log('Seeding default profiles to Supabase...');
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

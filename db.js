// db.js - IndexedDB wrapper for TrailCash with Transparent Fallbacks

const DB_NAME = 'TrailCashDB';
const DB_VERSION = 6;

let dbInstance = null;
let useInMemoryFallback = false;

// Default Seed Data - Owner Rishabh and default staff members
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

const DEFAULT_TRANSACTIONS = [];
const DEFAULT_EXPENSES = [];

// Mock in-memory database cache
const inMemoryData = {
  cash_transactions: [],
  expenses: [],
  staff: [...DEFAULT_STAFF],
  notes: []
};

function getDB() {
  if (useInMemoryFallback) {
    return Promise.resolve(null);
  }
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve) => {
    // Set a 1.2-second timeout to fall back to in-memory DB if blocked by locks
    const timeoutId = setTimeout(() => {
      console.warn('IndexedDB open timed out/blocked. Falling back to in-memory database.');
      useInMemoryFallback = true;
      resolve(null);
    }, 1200);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      console.warn('IndexedDB open blocked by another tab.');
    };

    request.onupgradeneeded = (event) => {
      try {
        const db = event.target.result;
        
        // Upgrade from version < 6: Clear old stores to start fresh
        if (event.oldVersion > 0 && event.oldVersion < 6) {
          console.log('Upgrading database to version 6. Wiping old data...');
          const storeNames = ['batches', 'cash_transactions', 'expenses', 'staff', 'notes'];
          storeNames.forEach(name => {
            if (db.objectStoreNames.contains(name)) {
              db.deleteObjectStore(name);
            }
          });
        }

        // Create Cash Transactions store
        if (!db.objectStoreNames.contains('cash_transactions')) {
          db.createObjectStore('cash_transactions', { keyPath: 'id' });
        }

        // Create Expenses store
        if (!db.objectStoreNames.contains('expenses')) {
          db.createObjectStore('expenses', { keyPath: 'id' });
        }

        // Create Staff registry store
        if (!db.objectStoreNames.contains('staff')) {
          db.createObjectStore('staff', { keyPath: 'id' });
        }

        // Create Notes store
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
      } catch (err) {
        console.error('Error in onupgradeneeded:', err);
      }
    };

    request.onsuccess = (event) => {
      clearTimeout(timeoutId);
      dbInstance = event.target.result;
      
      // Close connection when database version changes elsewhere to prevent locks
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
        console.warn('Database version changed elsewhere. Connection closed.');
      };
      
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      clearTimeout(timeoutId);
      console.error('IndexedDB open error:', event.target.error);
      console.warn('Falling back to in-memory database due to opening error.');
      useInMemoryFallback = true;
      resolve(null);
    };
  });
}

// Helper to run a transaction
function runTx(storeName, mode, callback) {
  return getDB().then((db) => {
    if (useInMemoryFallback || !db) {
      return Promise.reject(new Error('IndexedDB not available'));
    }
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        
        let result;
        try {
          result = callback(store);
        } catch (err) {
          tx.abort();
          reject(err);
          return;
        }

        tx.oncomplete = () => {
          resolve(result);
        };

        tx.onerror = (event) => {
          reject(event.target.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Convert request to promise
function prom(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

const db = {
  // Cash Transactions
  getCashTransactions() {
    if (useInMemoryFallback) return Promise.resolve(inMemoryData.cash_transactions);
    return runTx('cash_transactions', 'readonly', (store) => prom(store.getAll()))
      .catch(err => {
        console.warn('getCashTransactions failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return Promise.resolve(inMemoryData.cash_transactions);
      });
  },
  addCashTransaction(tx) {
    if (useInMemoryFallback) {
      const idx = inMemoryData.cash_transactions.findIndex(t => t.id === tx.id);
      if (idx >= 0) inMemoryData.cash_transactions[idx] = tx;
      else inMemoryData.cash_transactions.push(tx);
      return Promise.resolve(tx);
    }
    return runTx('cash_transactions', 'readwrite', (store) => prom(store.put(tx)))
      .catch(err => {
        console.warn('addCashTransaction failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return this.addCashTransaction(tx);
      });
  },

  // Expenses
  getExpenses() {
    if (useInMemoryFallback) return Promise.resolve(inMemoryData.expenses);
    return runTx('expenses', 'readonly', (store) => prom(store.getAll()))
      .catch(err => {
        console.warn('getExpenses failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return Promise.resolve(inMemoryData.expenses);
      });
  },
  addExpense(expense) {
    if (useInMemoryFallback) {
      const idx = inMemoryData.expenses.findIndex(e => e.id === expense.id);
      if (idx >= 0) inMemoryData.expenses[idx] = expense;
      else inMemoryData.expenses.push(expense);
      return Promise.resolve(expense);
    }
    return runTx('expenses', 'readwrite', (store) => prom(store.put(expense)))
      .catch(err => {
        console.warn('addExpense failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return this.addExpense(expense);
      });
  },
  updateExpense(expense) {
    return this.addExpense(expense);
  },
  deleteExpense(id) {
    if (useInMemoryFallback) {
      inMemoryData.expenses = inMemoryData.expenses.filter(e => e.id !== id);
      return Promise.resolve(id);
    }
    return runTx('expenses', 'readwrite', (store) => prom(store.delete(id)))
      .catch(err => {
        console.warn('deleteExpense failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return this.deleteExpense(id);
      });
  },

  // Staff Registry
  getStaff() {
    if (useInMemoryFallback) return Promise.resolve(inMemoryData.staff);
    return runTx('staff', 'readonly', (store) => prom(store.getAll()))
      .catch(err => {
        console.warn('getStaff failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return Promise.resolve(inMemoryData.staff);
      });
  },
  addStaff(staffMember) {
    if (useInMemoryFallback) {
      const idx = inMemoryData.staff.findIndex(s => s.id === staffMember.id);
      if (idx >= 0) inMemoryData.staff[idx] = staffMember;
      else inMemoryData.staff.push(staffMember);
      return Promise.resolve(staffMember);
    }
    return runTx('staff', 'readwrite', (store) => prom(store.put(staffMember)))
      .catch(err => {
        console.warn('addStaff failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return this.addStaff(staffMember);
      });
  },
  updateStaff(staffMember) {
    return this.addStaff(staffMember);
  },
  deleteStaff(id) {
    if (useInMemoryFallback) {
      inMemoryData.staff = inMemoryData.staff.filter(s => s.id !== id);
      return Promise.resolve(id);
    }
    return runTx('staff', 'readwrite', (store) => prom(store.delete(id)))
      .catch(err => {
        console.warn('deleteStaff failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return this.deleteStaff(id);
      });
  },

  // Shared Bulletin Notes
  getNotes() {
    if (useInMemoryFallback) return Promise.resolve(inMemoryData.notes);
    return runTx('notes', 'readonly', (store) => prom(store.getAll()))
      .catch(err => {
        console.warn('getNotes failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return Promise.resolve(inMemoryData.notes);
      });
  },
  addNote(note) {
    if (useInMemoryFallback) {
      const idx = inMemoryData.notes.findIndex(n => n.id === note.id);
      if (idx >= 0) inMemoryData.notes[idx] = note;
      else inMemoryData.notes.push(note);
      return Promise.resolve(note);
    }
    return runTx('notes', 'readwrite', (store) => prom(store.put(note)))
      .catch(err => {
        console.warn('addNote failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return this.addNote(note);
      });
  },
  deleteNote(id) {
    if (useInMemoryFallback) {
      inMemoryData.notes = inMemoryData.notes.filter(n => n.id !== id);
      return Promise.resolve(id);
    }
    return runTx('notes', 'readwrite', (store) => prom(store.delete(id)))
      .catch(err => {
        console.warn('deleteNote failed, falling back to in-memory:', err);
        useInMemoryFallback = true;
        return this.deleteNote(id);
      });
  },

  // Reset all transaction, expense, and note data (keeping staff roster intact)
  resetAllData() {
    if (useInMemoryFallback) {
      inMemoryData.cash_transactions = [];
      inMemoryData.expenses = [];
      inMemoryData.notes = [];
      return Promise.resolve();
    }
    return Promise.all([
      runTx('cash_transactions', 'readwrite', (store) => prom(store.clear())),
      runTx('expenses', 'readwrite', (store) => prom(store.clear())),
      runTx('notes', 'readwrite', (store) => prom(store.clear()))
    ]).catch(err => {
      console.warn('resetAllData failed, falling back to in-memory reset:', err);
      useInMemoryFallback = true;
      inMemoryData.cash_transactions = [];
      inMemoryData.expenses = [];
      inMemoryData.notes = [];
    });
  },

  // Initialize and Seed Data if empty
  async initAndSeed() {
    try {
      // Ensure database is initialized (either IndexedDB opens or sets fallback)
      await getDB();
    } catch (e) {
      console.warn('getDB failed in initAndSeed, forcing fallback:', e);
      useInMemoryFallback = true;
    }

    try {
      // Seed staff registry if empty
      const staff = await this.getStaff();
      if (staff.length === 0) {
        console.log('Seeding initial staff registry...');
        for (const s of DEFAULT_STAFF) {
          await this.addStaff(s);
        }
      }
      console.log('Database initialization completed successfully!');
    } catch (err) {
      console.warn('DB Seeding failed, forcing fallback setup:', err);
      useInMemoryFallback = true;
    }
  }
};

// Export db to global window object
window.TrailCashDB = db;

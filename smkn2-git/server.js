const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database
const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

// Init tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nama TEXT,
  role TEXT NOT NULL DEFAULT 'guru',
  pegawai_id INTEGER,
  created_at datetime default CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  expires_at datetime
);
CREATE TABLE IF NOT EXISTS surat_masuk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor TEXT, tanggal TEXT, dari TEXT, perihal TEXT, foto TEXT,
  created_at datetime default CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS surat_keluar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor TEXT, tanggal TEXT, tujuan TEXT, perihal TEXT, isi TEXT, jenis TEXT,
  created_at datetime default CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pegawai (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT, nip TEXT, tempat_lahir TEXT, tanggal_lahir TEXT,
  golongan TEXT, jabatan TEXT, status TEXT, masa_jabatan TEXT,
  tanggal_naik_pangkat TEXT, no_hp TEXT, alamat TEXT
);
CREATE TABLE IF NOT EXISTS absensi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pegawai_id INTEGER, tanggal TEXT, jam TEXT, status TEXT, telat_menit INTEGER,
  lat REAL, lng REAL,
  FOREIGN KEY(pegawai_id) REFERENCES pegawai(id)
);
CREATE TABLE IF NOT EXISTS laporan_bulanan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pegawai_id INTEGER, divisi TEXT, bulan TEXT,
  kegiatan TEXT, target TEXT, realisasi TEXT, kendala TEXT, catatan TEXT, foto TEXT,
  status TEXT DEFAULT 'Belum Dinilai', nilai TEXT, komentar_kasubag TEXT,
  created_at datetime default CURRENT_TIMESTAMP,
  UNIQUE(pegawai_id, bulan)
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, username TEXT, nama TEXT, role TEXT,
  aksi TEXT, detail TEXT,
  created_at datetime default CURRENT_TIMESTAMP
);
`);

// Tambah kolom lat/lng kalau tabel lama belum punya (migrasi aman)
const absCols = db.prepare("PRAGMA table_info(absensi)").all().map(c => c.name);
if (!absCols.includes('lat')) db.exec("ALTER TABLE absensi ADD COLUMN lat REAL");
if (!absCols.includes('lng')) db.exec("ALTER TABLE absensi ADD COLUMN lng REAL");

// Helpers
function hashPass(pw) {
  return crypto.createHash('sha256').update(pw + ':smkn2salt').digest('hex');
}
function getUser(req) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return null;
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token);
  return row || null;
}
function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Belum login' });
  req.user = user;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Belum login' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Tidak punya hak akses' });
    req.user = user;
    next();
  };
}
function log(user, aksi, detail) {
  try {
    db.prepare('INSERT INTO activity_log (user_id,username,nama,role,aksi,detail) VALUES (?,?,?,?,?,?)')
      .run(user.id, user.username, user.nama, user.role, aksi, detail);
  } catch(e) { /* log jangan sampai gagalkan request */ }
}

// Seed users if empty
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const ins = db.prepare('INSERT INTO users (username,password_hash,nama,role) VALUES (?,?,?,?)');
  ins.run('admin', hashPass('admin123'), 'Administrator', 'admin');
  ins.run('kepsek', hashPass('kepsek123'), 'Kepala Sekolah', 'kepsek');
  ins.run('kasubag', hashPass('kasubag123'), 'Kasubag TU', 'kasubag');
  ins.run('staff', hashPass('staff123'), 'Staff TU', 'staff');
  const insG = db.prepare('INSERT INTO users (username,password_hash,nama,role,pegawai_id) VALUES (?,?,?,?,?)');
  insG.run('budi', hashPass('guru123'), 'Budi Santoso, S.Pd', 'guru', 1);
  insG.run('siti', hashPass('guru123'), 'Siti Rahayu, M.Pd', 'guru', 2);
  insG.run('ahmad', hashPass('guru123'), 'Ahmad Yani, S.Pd', 'guru', 3);
  insG.run('dewi', hashPass('guru123'), 'Dewi Lestari, S.Pd', 'guru', 4);
  insG.run('rudi', hashPass('guru123'), 'Rudi Hermawan, S.Pd', 'guru', 5);
  insG.run('fitri', hashPass('guru123'), 'Fitri Handayani, S.Pd', 'guru', 6);
}

// ========== AUTH ==========
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || user.password_hash !== hashPass(password)) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24*60*60*1000).toISOString();
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, user.id, expires);
  log(user, 'Login', `Login dari perangkat`);
  res.json({ ok: true, token, user: { id: user.id, username: user.username, nama: user.nama, role: user.role, pegawai_id: user.pegawai_id } });
});
app.post('/api/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Belum login' });
  res.json({ id: user.id, username: user.username, nama: user.nama, role: user.role, pegawai_id: user.pegawai_id });
});
app.post('/api/ganti-password', requireAuth, (req, res) => {
  const { lama, baru } = req.body;
  if (!baru || baru.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
  if (req.user.password_hash !== hashPass(lama)) return res.status(400).json({ error: 'Password lama salah' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPass(baru), req.user.id);
  log(req.user, 'Ganti Password', 'Password berhasil diganti');
  res.json({ ok: true });
});

// Upload config
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
const upload = multer({ dest: uploadsDir });
app.use('/uploads', express.static(uploadsDir));

// ========== SURAT MASUK ==========
app.get('/api/surat-masuk', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM surat_masuk ORDER BY tanggal DESC').all();
  res.json(rows);
});
app.post('/api/surat-masuk', requireRole('admin','kasubag','staff'), upload.single('foto'), (req, res) => {
  const { nomor, tanggal, dari, perihal } = req.body;
  const foto = req.file ? req.file.filename : null;
  db.prepare('INSERT INTO surat_masuk (nomor,tanggal,dari,perihal,foto) VALUES (?,?,?,?,?)').run(nomor,tanggal,dari,perihal,foto);
  log(req.user, 'Surat Masuk', `Input surat ${nomor} dari ${dari}`);
  res.json({ ok: true });
});
app.put('/api/surat-masuk/:id', requireRole('admin','kasubag','staff'), (req, res) => {
  const { nomor, tanggal, dari, perihal } = req.body;
  db.prepare('UPDATE surat_masuk SET nomor=?, tanggal=?, dari=?, perihal=? WHERE id=?').run(nomor, tanggal, dari, perihal, req.params.id);
  log(req.user, 'Surat Masuk', `Edit surat ${nomor}`);
  res.json({ ok: true });
});
app.delete('/api/surat-masuk/:id', requireRole('admin','kasubag','staff'), (req, res) => {
  const row = db.prepare('SELECT nomor FROM surat_masuk WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM surat_masuk WHERE id=?').run(req.params.id);
  log(req.user, 'Surat Masuk', `Hapus surat ${row ? row.nomor : ''}`);
  res.json({ ok: true });
});

// ========== SURAT KELUAR ==========
app.get('/api/surat-keluar', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM surat_keluar ORDER BY tanggal DESC').all();
  res.json(rows);
});
app.post('/api/surat-keluar', requireRole('admin','kasubag','staff'), (req, res) => {
  const { nomor, tanggal, tujuan, perihal, isi, jenis } = req.body;
  db.prepare('INSERT INTO surat_keluar (nomor,tanggal,tujuan,perihal,isi,jenis) VALUES (?,?,?,?,?,?)').run(nomor,tanggal,tujuan,perihal,isi,jenis);
  log(req.user, 'Surat Keluar', `Buat surat ${nomor} ke ${tujuan}`);
  res.json({ ok: true });
});
app.put('/api/surat-keluar/:id', requireRole('admin','kasubag','staff'), (req, res) => {
  const { nomor, tanggal, tujuan, perihal, isi, jenis } = req.body;
  db.prepare('UPDATE surat_keluar SET nomor=?, tanggal=?, tujuan=?, perihal=?, isi=?, jenis=? WHERE id=?').run(nomor, tanggal, tujuan, perihal, isi, jenis, req.params.id);
  log(req.user, 'Surat Keluar', `Edit surat ${nomor}`);
  res.json({ ok: true });
});
app.delete('/api/surat-keluar/:id', requireRole('admin','kasubag','staff'), (req, res) => {
  const row = db.prepare('SELECT nomor FROM surat_keluar WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM surat_keluar WHERE id=?').run(req.params.id);
  log(req.user, 'Surat Keluar', `Hapus surat ${row ? row.nomor : ''}`);
  res.json({ ok: true });
});
app.get('/api/surat-keluar/:id/pdf', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM surat_keluar WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).send('Not found');
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=surat-${s.nomor.replace(/\//g,'_')}.pdf`);
  doc.pipe(res);
  doc.fontSize(14).text('SMKN 2 Rantau', { align: 'center' });
  doc.fontSize(10).text('Kabupaten Tapin, Kalimantan Selatan', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Nomor: ${s.nomor}`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(11).text(`Tanggal: ${s.tanggal}`);
  doc.text(`Tujuan: ${s.tujuan}`);
  doc.text(`Perihal: ${s.perihal}`);
  doc.moveDown();
  doc.text(s.isi || '');
  doc.moveDown(2);
  doc.text('Rantau, ' + new Date().toLocaleDateString('id-ID'), { align: 'right' });
  doc.text('Kepala Sekolah', { align: 'right' });
  doc.moveDown(2);
  doc.text('(........................)', { align: 'right' });
  doc.end();
});

// ========== PEGAWAI ==========
app.get('/api/pegawai', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM pegawai ORDER BY nama').all();
  res.json(rows);
});
app.post('/api/pegawai', requireRole('admin','kasubag'), (req, res) => {
  const p = req.body;
  const info = db.prepare(`INSERT INTO pegawai (nama,nip,tempat_lahir,tanggal_lahir,golongan,jabatan,status,masa_jabatan,tanggal_naik_pangkat,no_hp,alamat)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(p.nama,p.nip,p.tempat_lahir,p.tanggal_lahir,p.golongan,p.jabatan,p.status,p.masa_jabatan,p.tanggal_naik_pangkat,p.no_hp,p.alamat);
  log(req.user, 'Pegawai', `Tambah pegawai ${p.nama}`);
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.put('/api/pegawai/:id', requireRole('admin','kasubag'), (req, res) => {
  const p = req.body;
  db.prepare(`UPDATE pegawai SET nama=?,nip=?,tempat_lahir=?,tanggal_lahir=?,golongan=?,jabatan=?,status=?,masa_jabatan=?,tanggal_naik_pangkat=?,no_hp=?,alamat=? WHERE id=?`)
    .run(p.nama,p.nip,p.tempat_lahir,p.tanggal_lahir,p.golongan,p.jabatan,p.status,p.masa_jabatan,p.tanggal_naik_pangkat,p.no_hp,p.alamat, req.params.id);
  log(req.user, 'Pegawai', `Edit pegawai ${p.nama}`);
  res.json({ ok: true });
});
app.delete('/api/pegawai/:id', requireRole('admin','kasubag'), (req, res) => {
  const row = db.prepare('SELECT nama FROM pegawai WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM absensi WHERE pegawai_id=?').run(req.params.id);
  db.prepare('DELETE FROM pegawai WHERE id=?').run(req.params.id);
  log(req.user, 'Pegawai', `Hapus pegawai ${row ? row.nama : ''}`);
  res.json({ ok: true });
});
app.get('/api/pegawai/notifikasi', requireRole('admin','kasubag','kepsek'), (req, res) => {
  const rows = db.prepare("SELECT * FROM pegawai WHERE tanggal_naik_pangkat IS NOT NULL AND tanggal_naik_pangkat != ''").all();
  const today = new Date();
  const notifs = rows.filter(r => {
    const target = new Date(r.tanggal_naik_pangkat);
    const diff = (target - today) / (1000*60*60*24);
    return diff >= 0 && diff <= 90;
  });
  res.json(notifs);
});

// ========== ABSENSI ==========
app.get('/api/absensi', requireAuth, (req, res) => {
  const { tanggal } = req.query;
  const rows = db.prepare(`
    SELECT p.nama, a.jam, a.status, a.telat_menit FROM absensi a
    JOIN pegawai p ON p.id = a.pegawai_id
    WHERE a.tanggal = ? ORDER BY p.nama
  `).all(tanggal || new Date().toISOString().slice(0,10));
  res.json(rows);
});
app.post('/api/absensi', requireAuth, (req, res) => {
  const { pegawai_id, tanggal, jam, status, lat, lng } = req.body;
  if (req.user.role === 'guru' && req.user.pegawai_id !== Number(pegawai_id)) {
    return res.status(403).json({ error: 'Guru hanya bisa absen untuk diri sendiri' });
  }
  let telat = 0;
  if (status === 'Hadir') {
    const [h,m] = jam.split(':').map(Number);
    const menit = h*60 + m;
    const batas = 7*60 + 30;
    if (menit > batas) telat = menit - batas;
  }
  const existing = db.prepare('SELECT id FROM absensi WHERE pegawai_id=? AND tanggal=?').get(pegawai_id, tanggal);
  if (existing) return res.status(400).json({ error: 'Sudah absen hari ini' });
  db.prepare('INSERT INTO absensi (pegawai_id,tanggal,jam,status,telat_menit,lat,lng) VALUES (?,?,?,?,?,?,?)')
    .run(pegawai_id,tanggal,jam,status,telat, lat || null, lng || null);
  log(req.user, 'Absensi', `Absensi ${status} jam ${jam}${telat ? ' (telat '+telat+' mnt)' : ''}`);
  res.json({ ok: true, telat });
});
app.get('/api/absensi/rekap', requireRole('admin','kasubag','kepsek','staff'), async (req, res) => {
  const { bulan } = req.query;
  const rows = db.prepare(`
    SELECT p.nama,
      SUM(CASE WHEN a.status='Hadir' THEN 1 ELSE 0 END) as hadir,
      SUM(CASE WHEN a.telat_menit>0 THEN 1 ELSE 0 END) as telat,
      SUM(a.telat_menit) as total_telat,
      SUM(CASE WHEN a.status='Izin' THEN 1 ELSE 0 END) as izin,
      SUM(CASE WHEN a.status='Sakit' THEN 1 ELSE 0 END) as sakit
    FROM pegawai p LEFT JOIN absensi a ON a.pegawai_id=p.id AND a.tanggal LIKE ?
    GROUP BY p.id ORDER BY p.nama
  `).all(bulan + '%');
  res.json(rows);
});
app.get('/api/absensi/rekap/excel', requireRole('admin','kasubag','kepsek','staff'), async (req, res) => {
  const { bulan } = req.query;
  const rows = db.prepare(`
    SELECT p.nama,
      SUM(CASE WHEN a.status='Hadir' THEN 1 ELSE 0 END) as hadir,
      SUM(CASE WHEN a.telat_menit>0 THEN 1 ELSE 0 END) as telat,
      SUM(a.telat_menit) as total_telat,
      SUM(CASE WHEN a.status='Izin' THEN 1 ELSE 0 END) as izin,
      SUM(CASE WHEN a.status='Sakit' THEN 1 ELSE 0 END) as sakit
    FROM pegawai p LEFT JOIN absensi a ON a.pegawai_id=p.id AND a.tanggal LIKE ?
    GROUP BY p.id ORDER BY p.nama
  `).all(bulan + '%');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rekap');
  ws.columns = [
    { header: 'Nama', key: 'nama' },
    { header: 'Hadir', key: 'hadir' },
    { header: 'Telat', key: 'telat' },
    { header: 'Total Menit Telat', key: 'total_telat' },
    { header: 'Izin', key: 'izin' },
    { header: 'Sakit', key: 'sakit' },
  ];
  rows.forEach(r => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=rekap-${bulan}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// ========== REKAP SURAT ==========
app.get('/api/rekap/surat', requireRole('admin','kasubag','kepsek','staff'), (req, res) => {
  const { bulan } = req.query;
  const sm = db.prepare("SELECT COUNT(*) as total, dari, perihal, tanggal FROM surat_masuk WHERE tanggal LIKE ? GROUP BY dari ORDER BY tanggal DESC").all(bulan + '%');
  const sk = db.prepare("SELECT COUNT(*) as total, tujuan, perihal, tanggal FROM surat_keluar WHERE tanggal LIKE ? GROUP BY tujuan ORDER BY tanggal DESC").all(bulan + '%');
  const totalMasuk = db.prepare("SELECT COUNT(*) as c FROM surat_masuk WHERE tanggal LIKE ?").get(bulan + '%');
  const totalKeluar = db.prepare("SELECT COUNT(*) as c FROM surat_keluar WHERE tanggal LIKE ?").get(bulan + '%');
  res.json({ totalMasuk: totalMasuk.c, totalKeluar: totalKeluar.c, masukRinci: sm, keluarRinci: sk });
});
app.get('/api/rekap/surat/excel', requireRole('admin','kasubag','kepsek','staff'), async (req, res) => {
  const { bulan } = req.query;
  const sm = db.prepare("SELECT nomor, tanggal, dari, perihal FROM surat_masuk WHERE tanggal LIKE ? ORDER BY tanggal").all(bulan + '%');
  const sk = db.prepare("SELECT nomor, tanggal, tujuan, perihal FROM surat_keluar WHERE tanggal LIKE ? ORDER BY tanggal").all(bulan + '%');
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('Surat Masuk');
  ws1.columns = [{ header:'Nomor', key:'nomor' }, { header:'Tanggal', key:'tanggal' }, { header:'Dari', key:'dari' }, { header:'Perihal', key:'perihal' }];
  sm.forEach(r => ws1.addRow(r));
  const ws2 = wb.addWorksheet('Surat Keluar');
  ws2.columns = [{ header:'Nomor', key:'nomor' }, { header:'Tanggal', key:'tanggal' }, { header:'Tujuan', key:'tujuan' }, { header:'Perihal', key:'perihal' }];
  sk.forEach(r => ws2.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=rekap-surat-${bulan}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// ========== REKAP PEGAWAI ==========
app.get('/api/rekap/pegawai', requireRole('admin','kasubag','kepsek','staff'), (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM pegawai').get();
  const perStatus = db.prepare('SELECT status, COUNT(*) as c FROM pegawai GROUP BY status').all();
  const perGolongan = db.prepare('SELECT golongan, COUNT(*) as c FROM pegawai WHERE golongan IS NOT NULL AND length(golongan) > 0 GROUP BY golongan ORDER BY golongan').all();
  const perJabatan = db.prepare('SELECT jabatan, COUNT(*) as c FROM pegawai WHERE jabatan IS NOT NULL AND length(jabatan) > 0 GROUP BY jabatan ORDER BY c DESC').all();
  const semua = db.prepare('SELECT id, nama, nip, golongan, jabatan, status, masa_jabatan, tanggal_naik_pangkat FROM pegawai ORDER BY nama').all();
  res.json({ total: total.c, perStatus, perGolongan, perJabatan, semua });
});
app.get('/api/rekap/pegawai/excel', requireRole('admin','kasubag','kepsek','staff'), async (req, res) => {
  const rows = db.prepare('SELECT nama, nip, tempat_lahir, tanggal_lahir, golongan, jabatan, status, masa_jabatan, tanggal_naik_pangkat, no_hp, alamat FROM pegawai ORDER BY nama').all();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pegawai');
  ws.columns = [
    { header:'Nama', key:'nama' }, { header:'NIP', key:'nip' }, { header:'Tempat Lahir', key:'tempat_lahir' },
    { header:'Tanggal Lahir', key:'tanggal_lahir' }, { header:'Golongan', key:'golongan' }, { header:'Jabatan', key:'jabatan' },
    { header:'Status', key:'status' }, { header:'Masa Jabatan', key:'masa_jabatan' },
    { header:'Naik Pangkat', key:'tanggal_naik_pangkat' }, { header:'No HP', key:'no_hp' }, { header:'Alamat', key:'alamat' }
  ];
  rows.forEach(r => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=rekap-pegawai.xlsx');
  await wb.xlsx.write(res);
  res.end();
});

// ========== LAPORAN BULANAN ==========
const DIVISI = ["Administrasi Kesiswaan","Administrasi Keuangan","Administrasi Kurikulum","Dapodik","HUMAS","Keamanan dan Kebersihan","Kepegawaian","Persuratan dan Kearsipan","SARPRAS"];
app.get('/api/divisi', requireAuth, (req, res) => res.json(DIVISI));
app.get('/api/laporan', requireAuth, (req, res) => {
  const { bulan } = req.query;
  let rows;
  if (req.user.role === 'guru' || req.user.role === 'staff') {
    rows = db.prepare('SELECT l.*, p.nama FROM laporan_bulanan l JOIN pegawai p ON p.id=l.pegawai_id WHERE l.bulan=? AND l.pegawai_id=? ORDER BY p.nama').all(bulan, req.user.pegawai_id || 0);
  } else {
    rows = db.prepare('SELECT l.*, p.nama FROM laporan_bulanan l JOIN pegawai p ON p.id=l.pegawai_id WHERE l.bulan=? ORDER BY l.divisi, p.nama').all(bulan);
  }
  res.json(rows);
});
app.post('/api/laporan', requireAuth, upload.single('foto'), (req, res) => {
  const { pegawai_id, divisi, bulan, kegiatan, target, realisasi, kendala, catatan } = req.body;
  if (req.user.role !== 'admin' && req.user.role !== 'kasubag' && req.user.pegawai_id !== Number(pegawai_id)) {
    return res.status(403).json({ error: 'Hanya bisa upload laporan sendiri' });
  }
  const foto = req.file ? req.file.filename : null;
  const existing = db.prepare('SELECT id FROM laporan_bulanan WHERE pegawai_id=? AND bulan=?').get(pegawai_id, bulan);
  if (existing) {
    db.prepare('UPDATE laporan_bulanan SET divisi=?, kegiatan=?, target=?, realisasi=?, kendala=?, catatan=?, foto=IFNULL(?,foto), status=? WHERE id=?')
      .run(divisi, kegiatan, target, realisasi, kendala, catatan, foto, 'Belum Dinilai', existing.id);
    log(req.user, 'Laporan', `Update laporan ${bulan} (${divisi})`);
  } else {
    db.prepare('INSERT INTO laporan_bulanan (pegawai_id,divisi,bulan,kegiatan,target,realisasi,kendala,catatan,foto) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(pegawai_id, divisi, bulan, kegiatan, target, realisasi, kendala, catatan, foto);
    log(req.user, 'Laporan', `Upload laporan ${bulan} (${divisi})`);
  }
  res.json({ ok: true });
});
app.put('/api/laporan/:id/nilai', requireRole('admin','kasubag'), (req, res) => {
  const { nilai, komentar_kasubag } = req.body;
  db.prepare('UPDATE laporan_bulanan SET nilai=?, komentar_kasubag=?, status=? WHERE id=?').run(nilai, komentar_kasubag, 'Sudah Dinilai', req.params.id);
  log(req.user, 'Laporan', `Nilai laporan id ${req.params.id}: ${nilai}`);
  res.json({ ok: true });
});
app.get('/api/laporan/rekap', requireRole('admin','kasubag','kepsek','staff'), (req, res) => {
  const { bulan } = req.query;
  const rows = db.prepare(`
    SELECT l.divisi, COUNT(*) as total_laporan,
      SUM(CASE WHEN l.status='Sudah Dinilai' THEN 1 ELSE 0 END) as sudah_dinilai,
      SUM(CASE WHEN l.status='Belum Dinilai' THEN 1 ELSE 0 END) as belum_dinilai
    FROM laporan_bulanan l WHERE l.bulan=? GROUP BY l.divisi ORDER BY l.divisi
  `).all(bulan);
  const detail = db.prepare('SELECT l.*, p.nama FROM laporan_bulanan l JOIN pegawai p ON p.id=l.pegawai_id WHERE l.bulan=? ORDER BY l.divisi, p.nama').all(bulan);
  res.json({ rekapDivisi: rows, detail });
});

// ========== ACTIVITY LOG ==========
app.get('/api/log', requireRole('admin','kasubag','kepsek'), (req, res) => {
  const rows = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows);
});

// ========== BACKUP ==========
app.get('/api/backup', requireRole('admin','kasubag'), (req, res) => {
  const stamp = new Date().toISOString().slice(0,10);
  const dest = path.join(__dirname, `backup-${stamp}.db`);
  fs.copyFileSync(dbPath, dest);
  log(req.user, 'Backup', `Download backup database ${stamp}`);
  res.download(dest, `backup-smkn2-${stamp}.db`);
});

// Seed pegawai if empty
const count = db.prepare('SELECT COUNT(*) as c FROM pegawai').get();
if (count.c === 0) {
  const seed = db.prepare('INSERT INTO pegawai (nama,nip,golongan,jabatan,status,masa_jabatan) VALUES (?,?,?,?,?,?)');
  seed.run('Budi Santoso, S.Pd', '198501012010011001', 'III/a', 'Guru Matematika', 'PNS', '2010-2027');
  seed.run('Siti Rahayu, M.Pd', '198702142012012002', 'III/b', 'Guru Bahasa Indonesia', 'PNS', '2012-2028');
  seed.run('Ahmad Yani, S.Pd', '199003152015011003', 'III/a', 'Guru IPS', 'PNS', '2015-2029');
  seed.run('Dewi Lestari, S.Pd', '199104202016012004', 'III/a', 'Kasubag TU', 'PNS', '2016-2030');
  seed.run('Rudi Hermawan, S.Pd', '199205252017011005', 'II/c', 'Guru PJOK', 'PPPK', '2017-2029');
  seed.run('Fitri Handayani, S.Pd', '199306302018012006', 'II/c', 'Staff TU', 'PPPK', '2018-2030');
}

app.listen(PORT, () => console.log(`SMKN 2 Rantau TU running on :${PORT}`));

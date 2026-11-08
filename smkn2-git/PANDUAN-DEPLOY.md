# Panduan Deploy Gratis ke Render — 5 Menit

Sistem TU SMKN 2 Rantau ini bisa diakses Kepsek dari HP, tanpa sewa server, tanpa keluar duit dulu.

## Yang Kamu Butuhkan
- Akun GitHub gratis (github.com/signup) — daftar pakai email, 3 menit
- File ini: folder `smkn2-full`

## Langkah

### 1. Upload ke GitHub
- Buka github.com → New repository → nama: `smkn2-rantau-tu` → Public → Create
- Upload file: klik "uploading an existing file" → pilih semua file di folder `smkn2-full`
  (package.json, server.js, render.yaml, folder public)
- Commit

### 2. Deploy ke Render
- Buka render.com → Sign up gratis pakai GitHub
- Dashboard → New → Web Service
- Pilih repo `smkn2-rantau-tu` yang baru dibuat
- Isi:
  - Name: smkn2-rantau-tu
  - Runtime: Node
  - Build Command: `npm install`
  - Start Command: `npm start`
- Klik Create Web Service → tunggu 2-3 menit

### 3. Dapat Link Publik
- Render kasih link kayak: https://smkn2-rantau-tu.onrender.com
- Kirim link itu ke kakak kamu via WA
- Kepsek buka link dari HP → sistem langsung jalan

## Catatan Penting
- **Gratis tier Render:** tidur (sleep) kalau nggak dipakai 15 menit. Yang buka pertama kali harus nunggu ~30 detik — itu normal.
- **Data:** pakai SQLite di server Render. Data tersimpan selama server jalan. Buat demo & presentasi ini cukup. Nanti kalau deal, kita pindah ke database permanen (Postgres gratis di Render juga).
- **Kalau mau link cantik:** nanti beli domain .sch.id / .com (~150rb/thn) setelah deal — jangan beli sebelum deal.

## Setelah Presentasi ke Kepsek
- Kalau deal: pindah ke paket berbayar Render ($7/bln) / VPS, data permanen, domain beneran
- Kalau batal: kamu nggak keluar duit sama sekali. Hapus aja service Render-nya.

---
Lucas TECH • Sistem TU SMKN 2 Rantau • Deploy gratis, presentasi dulu, bayar belakangan

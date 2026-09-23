// Integration point: the host passes the account's existing language preference.
// ?lang=id is only a review aid for this standalone concept, not a new user setting.
(() => {
  const strings = {
    'Landing pages':'Landing page', 'New page':'Halaman baru', 'Interactive preview':'Pratinjau interaktif',
    'How would you like to build?':'Mau buat halaman dengan cara apa?',
    'Bring a finished design, or make something your own.':'Unggah desain yang sudah jadi, atau buat desainmu di sini.',
    'Image builder':'Halaman gambar', 'Visual builder':'Editor visual',
    'Upload & arrange':'Unggah & susun', 'Design & customize':'Desain & sesuaikan',
    'Have your design ready? Turn your images into a simple page for mobile shoppers.':'Sudah punya desain? Jadikan gambar-gambarmu halaman untuk pembeli di ponsel.',
    'Start with a template or a blank page. Make every part of the design your own.':'Mulai dari template atau halaman kosong. Sesuaikan setiap bagian desainmu.',
    'Upload and arrange images from your phone':'Unggah dan susun langsung dari ponsel',
    'One vertical layout, designed for phones':'Satu tata letak vertikal untuk ponsel',
    'Replace an image to change its text or design':'Ganti gambar untuk mengubah teks atau desainnya',
    'Edit text, images, buttons, and sections':'Edit teks, gambar, tombol, dan bagian halaman',
    'Layouts for desktop, tablet, and mobile':'Tata letak untuk desktop, tablet, dan ponsel',
    'Move, resize, and style individual elements':'Atur posisi, ukuran, dan tampilan tiap elemen',
    'Use image builder':'Pilih halaman gambar', 'Use visual builder':'Pilih editor visual', 'Try a preview':'Coba pratinjau',
    'Two ways to build. The same Ezkart checkout.':'Dua cara membuat. Checkout tetap di Ezkart.',
    'Connect your products. Customers order and pay through Ezkart.':'Hubungkan produkmu. Pembeli memesan dan membayar melalui Ezkart.',
    'Already designed your page in Canva? Choose':'Desain sudah jadi di Canva? Pilih',
    '. Want to design it here? Choose':'. Mau mendesain di sini? Pilih',
    'Want to design it here? Choose':'Mau mendesain di sini? Pilih',
    'Your images':'Gambarmu', 'Uploaded':'Sudah diunggah', 'Add images':'Tambah gambar',
    '01 · Introduction':'01 · Pembuka', '02 · The details':'02 · Detail', '03 · Your story':'03 · Ceritamu',
    'A page made from your images':'Halaman dari gambar-gambarmu',
    'A page you can edit element by element':'Halaman yang bisa diedit per elemen',
    'Sela · Your page':'Sela · Halamanmu', 'Publish':'Terbitkan', 'Elements':'Elemen', 'Sections':'Bagian',
    'Heading':'Judul', 'Font family':'Jenis huruf', 'Font size':'Ukuran huruf', 'Text color':'Warna teks',
    'Try the image builder':'Coba halaman gambar', 'Try the visual builder':'Coba editor visual',
    'Try the image builder preview':'Coba pratinjau pembuat dari gambar',
    'Try the visual builder preview':'Coba pratinjau editor visual',
    'Arrange finished images into a page, with Ezkart checkout ready below.':'Susun gambar menjadi halaman. Checkout Ezkart tersedia di bawahnya.',
    'Change the text and styling, then see your page at different screen sizes.':'Ubah teks dan tampilan, lalu lihat hasilnya di berbagai ukuran layar.',
    'Your product':'Produkmu', 'Example product · Rp349.000':'Contoh produk · Rp349.000',
    'Example product':'Contoh produk', 'Image':'Gambar',
    'Use the arrows to change the order. Your page updates as you go.':'Gunakan panah untuk mengubah urutan. Halamanmu langsung mengikuti.',
    'Add your own images':'Tambahkan gambarmu',
    'JPG, PNG or WebP. Images stay in this browser preview.':'JPG, PNG, atau WebP. Gambar hanya ada di pratinjau browser ini.',
    'Example restored. Images stay in this browser preview.':'Contoh dikembalikan. Gambar hanya ada di pratinjau browser ini.',
    'Reset example':'Kembalikan contoh', 'One mobile layout':'Satu tata letak ponsel',
    'Mobile page preview':'Pratinjau halaman ponsel', 'Editable page preview':'Pratinjau halaman yang dapat diedit',
    'Edit individual elements':'Edit setiap elemen',
    'Try changing the heading or color. The rest of your page stays in place.':'Coba ubah judul atau warna. Bagian lain tetap pada tempatnya.',
    'Button color':'Warna tombol', 'Terracotta':'Terakota', 'Forest green':'Hijau hutan', 'Ink blue':'Biru tinta',
    'Add a text section':'Tambah bagian teks',
    'This example shows a few controls. The visual builder also lets you move, resize, and style your page.':'Contoh ini menampilkan beberapa kontrol. Editor visual juga bisa mengatur posisi, ukuran, dan tampilan halaman.',
    'Preview screen size':'Ukuran layar pratinjau', 'Mobile':'Ponsel',
    'Example product · Nothing is published':'Contoh produk · Belum diterbitkan',
    'Close preview':'Tutup pratinjau', 'Use this builder':'Pilih pembuat ini',
    'Ezkart checkout':'Checkout Ezkart', 'The same purchase flow in both builders.':'Alur pembelian yang sama di kedua pembuat halaman.',
    'Close checkout preview':'Tutup pratinjau checkout', 'Natural oak · 1 item':'Kayu oak alami · 1 barang',
    'Product total':'Total produk',
    'Customers continue here to enter their details and complete payment through Ezkart.':'Pembeli melanjutkan di sini untuk mengisi data dan menyelesaikan pembayaran melalui Ezkart.',
    'Back to the example':'Kembali ke contoh',
    'This is a preview. No order or payment will be created.':'Ini hanya pratinjau. Tidak ada pesanan atau pembayaran yang dibuat.',
    'Image builder selected. This preview does not create a page.':'Halaman gambar dipilih. Pratinjau ini tidak membuat halaman.',
    'Visual builder selected. This preview does not create a page.':'Editor visual dipilih. Pratinjau ini tidak membuat halaman.',
    'Dismiss selection message':'Tutup pesan pilihan',
  };
  const reverse = Object.fromEntries(Object.entries(strings).map(([key,value])=>[value,key]));
  let lang='en';
  const originalText=new WeakMap();
  const originalLabels=new WeakMap();
  function translate(value){
    const base=reverse[value]||value;
    if(lang==='en')return base;
    if(strings[base])return strings[base];
    if(/^\d+ (images|files)$/.test(base))return base.replace('images','gambar').replace('files','file');
    const move=/^Move (.*) (up|down)$/.exec(base);
    if(move)return `Pindahkan ${move[1]} ke ${move[2]==='up'?'atas':'bawah'}`;
    if(/^\d+ images? added\./.test(base))return base.replace(/^(\d+) images? added\./,'$1 gambar ditambahkan.').replace(' Some files could not be added. Use JPG, PNG or WebP up to 15 MB.',' Beberapa file tidak dapat ditambahkan. Gunakan JPG, PNG, atau WebP hingga 15 MB.');
    return base;
  }
  function apply(root=document.body){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;
      if(['SCRIPT','STYLE'].includes(node.parentElement?.tagName))continue;
      let raw=node.textContent;
      const saved=originalText.get(node);
      if(saved && (raw===saved.translated||raw===saved.original))raw=saved.original;
      const clean=raw.trim();if(!clean)continue;
      const output=raw.replace(clean,translate(clean));
      originalText.set(node,{original:raw,translated:output});
      if(node.textContent!==output)node.textContent=output;
    }
    root.querySelectorAll('[aria-label]').forEach(node=>{
      const value=node.getAttribute('aria-label');
      const saved=originalLabels.get(node);
      const raw=saved&&(value===saved.original||value===saved.translated)?saved.original:value;
      const translated=translate(raw);
      originalLabels.set(node,{original:raw,translated});node.setAttribute('aria-label',translated);
    });
  }
  window.EzkartBuilderChoice={
    applyLanguage:apply,
    setLanguage(value){lang=/^(id|id-ID|Bahasa Indonesia)$/i.test(value)?'id':'en';document.documentElement.lang=lang;apply();},
    getLanguage:()=>lang,
  };
  // The real page should receive the resolved setting from the existing admin host.
  window.EzkartBuilderChoice.setLanguage(new URLSearchParams(location.search).get('lang')||document.documentElement.lang);
})();

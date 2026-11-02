// Halaman HTML diagram interaktif — MURNI (30 Sep 2026).
//
// ⚠️ MANDIRI: tanpa skrip/font/gambar dari luar. Berkasnya dibuka dari disk di
// browser mana pun, sering tanpa internet, dan dikirim ke orang lain lewat email
// — ketergantungan pada CDN berarti diagram kosong di laptop penerima.
// ⚠️ Data untuk panel detail ditanam sebagai JSON dengan `<` di-escape jadi
// < — tanpa itu label berisi "</script>" memutus skripnya.

import type { SpekDiagram } from './rules'
import { esc } from './svg'

export function keHtml(spek: SpekDiagram, svg: string, dibuat: Date): string {
  const kelompok = new Map(spek.kelompok.map((k) => [k.id, k.label]))
  const data = JSON.stringify({
    simpul: spek.simpul.map((s) => ({
      id: s.id,
      label: s.label,
      keterangan: s.keterangan,
      kelompok: s.kelompok ? kelompok.get(s.kelompok) ?? null : null
    })),
    hubungan: spek.hubungan.map((h) => ({ dari: h.dari, ke: h.ke, label: h.label }))
  }).replace(/</g, '\\u003c')
  const tanggal = dibuat.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spek.judul)} — Diagram AIRA</title>
<style>
:root{--hijau:#1f7a45;--teks:#1d2b22;--redup:#66736b;--garis:#dfe6e1}
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:"Segoe UI",Arial,sans-serif;color:var(--teks);background:#f5f7f6}
header{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fff;border-bottom:1px solid var(--garis);flex-wrap:wrap}
header h1{font-size:16px;margin:0 12px 0 0;flex:1;min-width:180px}
header input{height:34px;border:1px solid var(--garis);border-radius:9px;padding:0 10px;font:inherit;font-size:13px;width:220px}
header button{height:34px;min-width:34px;border:1px solid var(--garis);border-radius:9px;background:#fff;font:inherit;font-size:13px;cursor:pointer;padding:0 10px}
header button:hover{border-color:#a9cdb4}header button.utama{background:var(--hijau);color:#fff;border-color:var(--hijau)}
main{position:absolute;top:56px;left:0;right:0;bottom:28px;overflow:hidden;cursor:grab}main.geser{cursor:grabbing}
main svg{width:100%;height:100%;display:block;user-select:none}
.simpul{cursor:pointer}.simpul:hover>*:first-child{filter:drop-shadow(0 2px 6px rgba(31,122,69,.35))}
svg.fokus .simpul,svg.fokus .garis,svg.fokus .label-garis{opacity:.15;transition:opacity .15s}
svg.fokus .terang{opacity:1!important}svg.fokus .garis.terang{stroke:var(--hijau);stroke-width:2.4}
.cocok>*:first-child{stroke:#e0772b!important;stroke-width:3!important}
aside{position:absolute;top:68px;right:12px;width:300px;max-height:calc(100% - 110px);overflow:auto;background:#fff;border:1px solid var(--garis);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.08);padding:14px 16px;display:none;font-size:13px;line-height:1.5}
aside.buka{display:block}aside h2{font-size:15px;margin:0 22px 6px 0}aside .kel{font-size:12px;color:var(--hijau);font-weight:600}
aside h3{font-size:12px;color:var(--redup);margin:12px 0 4px;text-transform:uppercase;letter-spacing:.4px}aside ul{margin:0;padding-left:18px}
aside .tutup{position:absolute;right:10px;top:8px;border:none;background:none;font-size:18px;cursor:pointer;color:var(--redup)}
aside li a{color:var(--teks);cursor:pointer;text-decoration:underline dotted}
footer{position:absolute;left:0;right:0;bottom:0;height:28px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:11.5px;color:var(--redup);background:#fff;border-top:1px solid var(--garis)}
</style></head>
<body>
<header>
  <h1>${esc(spek.judul)}</h1>
  <input id="cari" placeholder="Cari simpul…" aria-label="Cari simpul">
  <button id="kecil" title="Perkecil">−</button><button id="besar" title="Perbesar">+</button>
  <button id="pas" title="Paskan ke layar">Pas</button>
  <button id="png" class="utama" title="Simpan sebagai gambar PNG">Unduh PNG</button>
</header>
<main id="kanvas">${svg}</main>
<aside id="panel"><button class="tutup" id="tutup" title="Tutup">×</button><div id="isiPanel"></div></aside>
<footer><span>Geser: seret · Zoom: roda mouse · Klik simpul untuk detail</span><span>Dibuat oleh AIRA · ${esc(tanggal)}</span></footer>
<script type="application/json" id="data">${data}</script>
<script>
(function(){
  var D=JSON.parse(document.getElementById('data').textContent);
  var main=document.getElementById('kanvas'),svg=main.querySelector('svg');
  var asli=svg.getAttribute('viewBox').split(' ').map(Number);
  svg.removeAttribute('width');svg.removeAttribute('height');
  var vb=asli.slice();
  function terapkan(){svg.setAttribute('viewBox',vb.join(' '))}
  function pas(){vb=asli.slice();terapkan()}
  function zoom(f,cx,cy){var r=svg.getBoundingClientRect();var px=cx==null?.5:(cx-r.left)/r.width,py=cy==null?.5:(cy-r.top)/r.height;
    var w=vb[2]*f,h=vb[3]*f;if(w<80||w>asli[2]*8)return;vb=[vb[0]+(vb[2]-w)*px,vb[1]+(vb[3]-h)*py,w,h];terapkan()}
  main.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY>0?1.12:1/1.12,e.clientX,e.clientY)},{passive:false});
  var seret=null;
  main.addEventListener('mousedown',function(e){if(e.target.closest('.simpul'))return;seret={x:e.clientX,y:e.clientY,vb:vb.slice()};main.classList.add('geser')});
  window.addEventListener('mousemove',function(e){if(!seret)return;var r=svg.getBoundingClientRect(),s=Math.max(vb[2]/r.width,vb[3]/r.height);
    vb=[seret.vb[0]-(e.clientX-seret.x)*s,seret.vb[1]-(e.clientY-seret.y)*s,vb[2],vb[3]];terapkan()});
  window.addEventListener('mouseup',function(){seret=null;main.classList.remove('geser')});
  document.getElementById('besar').onclick=function(){zoom(1/1.25)};
  document.getElementById('kecil').onclick=function(){zoom(1.25)};
  document.getElementById('pas').onclick=pas;
  var byId={};D.simpul.forEach(function(s){byId[s.id]=s});
  var gSimpul=svg.querySelectorAll('.simpul'),gGaris=svg.querySelectorAll('.garis'),gLabel=svg.querySelectorAll('.label-garis');
  function fokus(id){svg.classList.toggle('fokus',!!id);var terkait={};terkait[id]=1;
    gGaris.forEach(function(p){var on=id&&(p.dataset.dari===id||p.dataset.ke===id);p.classList.toggle('terang',!!on);if(on){terkait[p.dataset.dari]=1;terkait[p.dataset.ke]=1}});
    gSimpul.forEach(function(g){g.classList.toggle('terang',!!terkait[g.dataset.id])})}
  function teks(t){var d=document.createElement('div');d.textContent=t==null?'':t;return d.innerHTML}
  function daftar(arr,kunci){if(!arr.length)return '<p style="color:#66736b;margin:0">—</p>';
    return '<ul>'+arr.map(function(h){var s=byId[h[kunci]];return '<li><a data-ke="'+teks(h[kunci])+'">'+teks(s?s.label:h[kunci])+'</a>'+(h.label?' <span style="color:#66736b">('+teks(h.label)+')</span>':'')+'</li>'}).join('')+'</ul>'}
  var panel=document.getElementById('panel'),isi=document.getElementById('isiPanel');
  function buka(id){var s=byId[id];if(!s)return;fokus(id);
    isi.innerHTML=(s.kelompok?'<div class="kel">'+teks(s.kelompok)+'</div>':'')+'<h2>'+teks(s.label)+'</h2>'+
      (s.keterangan?'<p style="margin:0">'+teks(s.keterangan)+'</p>':'')+
      '<h3>Masuk dari</h3>'+daftar(D.hubungan.filter(function(h){return h.ke===id}),'dari')+
      '<h3>Menuju</h3>'+daftar(D.hubungan.filter(function(h){return h.dari===id}),'ke');
    panel.classList.add('buka');
    isi.querySelectorAll('a[data-ke]').forEach(function(a){a.onclick=function(){buka(a.dataset.ke)}})}
  gSimpul.forEach(function(g){g.addEventListener('click',function(){buka(g.dataset.id)})});
  document.getElementById('tutup').onclick=function(){panel.classList.remove('buka');fokus(null)};
  document.getElementById('cari').addEventListener('input',function(e){var q=e.target.value.trim().toLowerCase();
    gSimpul.forEach(function(g){var s=byId[g.dataset.id];g.classList.toggle('cocok',!!q&&(s.label+' '+(s.keterangan||'')).toLowerCase().indexOf(q)>=0)})});
  document.getElementById('png').onclick=function(){
    var klon=svg.cloneNode(true);klon.setAttribute('viewBox',asli.join(' '));klon.setAttribute('width',asli[2]);klon.setAttribute('height',asli[3]);klon.classList.remove('fokus');
    klon.querySelectorAll('.terang,.cocok').forEach(function(n){n.classList.remove('terang');n.classList.remove('cocok')});
    var src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(klon));
    var img=new Image();img.onload=function(){var c=document.createElement('canvas'),k=2;c.width=asli[2]*k;c.height=asli[3]*k;
      var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);
      var a=document.createElement('a');a.download=document.title.replace(/[\\\\/:*?"<>|]/g,'').slice(0,80)+'.png';a.href=c.toDataURL('image/png');a.click()};img.src=src};
  pas();
})();
</script>
</body></html>
`
}

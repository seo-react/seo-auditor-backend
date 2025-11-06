import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import { URL } from 'url';
import mysql from 'mysql2/promise';
import fetch from 'node-fetch-native';
import { crawlSite } from './crawler.mjs';


const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});


const app = express();

// ✅ Middleware de segurança
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' http://localhost:3001");
  next();
});

// ✅ Middlewares padrão
app.use(cors());
app.use(express.json());

async function auditoriaAvancada(url) {
  const erros = [];

  // Verifica robots.txt
  try {
    const robotsUrl = new URL('/robots.txt', url).href;
    const res = await fetch(robotsUrl);
    const robotsTxt = await res.text();
    if (robotsTxt.includes(`Disallow: ${new URL(url).pathname}`)) {
      erros.push({ tipo: 'Bloqueado por robots.txt', url });
    }
  } catch {
    erros.push({ tipo: 'Erro ao acessar robots.txt', url });
  }

  // Verifica status da URL
  try {
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status === 404) {
      erros.push({ tipo: 'Erro 404', url });
    } else if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location === url) {
        erros.push({ tipo: 'Loop de redirecionamento', url });
      }
    }
  } catch {
    erros.push({ tipo: 'Erro de conexão', url });
  }

  // Verifica meta tags e headings com Puppeteer
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); // ✅ 15 segundos

  const meta = await page.evaluate(() => {
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      h1: document.querySelectorAll('h1').length,
      h2: document.querySelectorAll('h2').length,
      imgsSemAlt: Array.from(document.querySelectorAll('img')).filter(img => !img.alt).length
    };
  });

  if (!meta.title) erros.push({ tipo: 'Título ausente', url });
  if (!meta.description) erros.push({ tipo: 'Meta description ausente', url });
  if (meta.h1 > 1) erros.push({ tipo: 'Excesso de H1', url });
  if (meta.h2 === 0) erros.push({ tipo: 'Sem H2', url });
  if (meta.imgsSemAlt > 0) {
  erros.push({
    tipo: 'Imagens sem alt',
    quantidade: meta.imgsSemAlt,
    url
  });
}


  await browser.close();

  return erros;
}

// ✅ Rota de auditoria
app.post('/api/auditar', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'URL inválida' });
  }

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--remote-debugging-port=9222', '--no-sandbox']
    });

    const endpoint = browser.wsEndpoint();
    const endpointURL = new URL(endpoint);
    const port = endpointURL.port;

    const result = await lighthouse(url, {
      port,
      output: 'json',
      onlyCategories: ['performance', 'seo', 'accessibility']
    });

    await browser.close();

    const { categories, audits } = result.lhr;

    console.log('🔍 Categorias retornadas pelo Lighthouse:');
console.log(JSON.stringify(categories, null, 2));



    const rastreamento = await crawlSite(url);
const errosAvancados = [];

const paginasAuditadas = rastreamento
  .filter(p => p.status === 200) // ✅ só páginas válidas
  .slice(0, 10); // ✅ limite de 10 páginas


function auditoriaComTimeout(url, timeout = 20000) {
  return Promise.race([
    auditoriaAvancada(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
  ]);
}

for (const pagina of paginasAuditadas) {
  try {
    const errosPagina = await auditoriaComTimeout(pagina.url);
    errosAvancados.push(...errosPagina);
  } catch (err) {
    console.warn('⏱️ Auditoria excedeu tempo:', pagina.url);
  }
}


const urls404 = errosAvancados
  .filter(erro => erro.tipo === 'Erro 404')
  .map(erro => erro.url);


    const report = {
      url,
      seoScore: categories.seo.score * 100,
      performanceScore: categories.performance.score * 100,
      accessibilityScore: categories?.accessibility?.score !== undefined && categories.accessibility.score !== null
  ? Math.round(categories.accessibility.score * 100)
  : null,
      loadTime: audits['interactive'].displayValue,
      issues: Object.values(audits)
        .filter(a => a.score !== null && a.score < 0.9)
        .map(a => a.title),
      errosAvancados,
      rastreamento,
      urls404,

    };

    res.json(report);

    await db.execute(
      'INSERT INTO relatorios (url, seo_score, performance_score, accessibility_score, load_time, issues, erros_avancados) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        report.url,
        report.seoScore,
        report.performanceScore,
        report.accessibilityScore,
        report.loadTime,
        JSON.stringify(report.issues),
        JSON.stringify(report.errosAvancados)
      ]
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao executar auditoria' });
  }
});


// ✅ Rota de histórico
app.get('/api/historico', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM relatorios ORDER BY data DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// ✅ Inicialização do servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});


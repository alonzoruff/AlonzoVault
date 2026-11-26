'use strict';
/*
 * Exercise of the Day: each exercise has its own public address,
 * /exercise-of-the-day/<slug>, rendered by the server so search
 * engines read the full text without running the app. The list of
 * exercises lives in content/exercise_of_the_day.json and is edited
 * by hand: one entry per exercise, each with the day it is featured.
 * An entry dated after today stays hidden (no page, not in the
 * sitemap) until its day comes, so exercises can be lined up ahead.
 *
 * Only exercises Coach AJ has chosen to make public belong in that
 * file. The full exercise library stays behind sign-in.
 */

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EOTD_BASE = '/exercise-of-the-day';

function str(v, max) {
  return typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null;
}
function realDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/* One entry, checked. Returns { entry } or { error }. */
function checkEntry(raw, i) {
  const at = 'Exercise ' + (i + 1);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: at + ' is not an object.' };
  const slug = typeof raw.slug === 'string' ? raw.slug : '';
  if (!SLUG_RE.test(slug) || slug.length > 80) return { error: at + ' needs a slug of lower-case words joined by hyphens.' };
  if (!realDate(raw.date)) return { error: at + ' needs a date like 2026-11-26.' };
  const name = str(raw.name, 80);
  if (!name) return { error: at + ' needs a name.' };
  const why = str(raw.why, 900);
  if (!why) return { error: at + ' needs a "why it is good" paragraph.' };
  const targets = Array.isArray(raw.targets) ? raw.targets.map(t => str(t, 40)).filter(Boolean) : [];
  if (!targets.length || targets.length > 6 || targets.length !== raw.targets.length) return { error: at + ' needs 1 to 6 short targets.' };
  const steps = Array.isArray(raw.steps) ? raw.steps.map(t => str(t, 300)).filter(Boolean) : [];
  if (!steps.length || steps.length > 10 || steps.length !== raw.steps.length) return { error: at + ' needs 1 to 10 steps.' };
  const dose = str(raw.dose, 300);
  if (!dose) return { error: at + ' needs a dose.' };
  let program = null;
  if (raw.program != null) {
    const label = raw.program && str(raw.program.label, 80);
    const route = raw.program && raw.program.route;
    if (!label || !/^[a-z-]+$/.test(route || '')) return { error: at + ' has a program link without a label and a route.' };
    program = { label, route };
  }
  return { entry: { slug, date: raw.date, name, targets, why, steps, dose, program } };
}

/* The whole file, checked. Bad entries and repeated slugs are left
   out with a reason, so one typo never takes the pages down. */
function loadEotd(list) {
  const entries = [];
  const errors = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((raw, i) => {
    const r = checkEntry(raw, i);
    if (r.error) { errors.push(r.error); return; }
    if (seen.has(r.entry.slug)) { errors.push('Exercise ' + (i + 1) + ' repeats the slug ' + r.entry.slug + '.'); return; }
    seen.add(r.entry.slug);
    entries.push(r.entry);
  });
  return { entries, errors };
}

/* Entries whose day has come, newest first. The first is today's. */
function eotdLive(entries, today) {
  return entries.filter(e => e.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
function longDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + day + ', ' + y;
}
function eotdPath(e) { return EOTD_BASE + '/' + e.slug; }

/* The exercise card, the same markup the homepage has always used.
   headingTag is h3 on the homepage and h1 on the exercise's own page. */
function eotdArticleHtml(e, opts) {
  const o = opts || {};
  const h = o.headingTag || 'h3';
  const sub = h === 'h1' ? 'h2' : 'h4';
  const program = e.program
    ? '<a class="lp-more" href="/' + esc(e.program.route) + '" data-route="' + esc(e.program.route) + '">' + esc(e.program.label) + '</a>'
    : '';
  const own = o.ownPageLink
    ? '<p class="eotd-links"><a class="lp-more" href="' + esc(eotdPath(e)) + '">Open this exercise on its own page</a>' +
      '<a class="lp-more" href="' + EOTD_BASE + '">Past exercises of the day</a></p>'
    : '';
  return '<article class="lp-eotd">' +
    '<div class="lp-eotd-side" aria-hidden="true"><img src="/assets/ayg-lab-logo.jpg" alt=""><span>Demo video in the Lab library</span></div>' +
    '<div class="lp-eotd-body">' +
      '<' + h + ' class="eotd-name">' + esc(e.name) + '</' + h + '>' +
      '<ul class="lp-chips" aria-label="What it targets">' + e.targets.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
      '<div class="lp-eotd-cols">' +
        '<div><' + sub + '>Why it is good</' + sub + '><p>' + esc(e.why) + '</p></div>' +
        '<div><' + sub + '>How to do it</' + sub + '><ol>' + e.steps.map(s => '<li>' + esc(s) + '</li>').join('') + '</ol></div>' +
      '</div>' +
      '<p class="lp-dose"><span class="lp-dose-label">' + (h === 'h1' ? 'The dose' : 'Today\'s dose') + '</span><span>' + esc(e.dose) + '</span></p>' +
      program + own +
    '</div>' +
  '</article>';
}

/* The band on an exercise's own page, or on the list of them. */
function eotdPageBandHtml(e, live) {
  const others = live.filter(x => !e || x.slug !== e.slug);
  const list = others.length
    ? '<ul class="eotd-list">' + others.map(x =>
        '<li><a href="' + esc(eotdPath(x)) + '"><span class="eotd-list-name">' + esc(x.name) + '</span>' +
        '<span class="eotd-list-meta">' + esc(longDate(x.date)) + ' · ' + esc(x.targets.join(', ')) + '</span></a></li>').join('') + '</ul>'
    : '';
  if (e) {
    return '<div class="lp-band" id="eotd-page" data-lp-section="exercise"><div class="lp-wrap">' +
      '<nav class="eotd-crumbs" aria-label="Breadcrumb"><a href="/" data-route="home">Home</a> / <a href="' + EOTD_BASE + '">Exercise of the Day</a></nav>' +
      '<div class="lp-head"><span class="lp-eyebrow">Exercise of the Day · <time datetime="' + esc(e.date) + '">' + esc(longDate(e.date)) + '</time></span></div>' +
      eotdArticleHtml(e, { headingTag: 'h1' }) +
      (list ? '<h2 class="eotd-more-head">More exercises of the day</h2>' + list : '') +
    '</div></div>';
  }
  return '<div class="lp-band" id="eotd-page" data-lp-section="exercise"><div class="lp-wrap">' +
    '<nav class="eotd-crumbs" aria-label="Breadcrumb"><a href="/" data-route="home">Home</a></nav>' +
    '<div class="lp-head"><span class="lp-eyebrow">Exercise of the Day</span><h1>One exercise, done well.</h1>' +
    '<p class="lp-lead">One exercise from Coach AJ\'s library, with why it matters and how to do it. Free for everyone.</p></div>' +
    (list || '<p class="eotd-empty">There is no exercise of the day yet.</p>') +
  '</div></div>';
}

/* The search-engine tags for an exercise page or the list. */
function eotdHead(e, siteUrl, brandName) {
  const url = siteUrl + (e ? eotdPath(e) : EOTD_BASE);
  const title = e ? e.name + ': Exercise of the Day | ' + brandName : 'Exercise of the Day | ' + brandName;
  const desc = e
    ? e.name + ' from ' + brandName + "'s Exercise of the Day: why it is good, how to do it, and the dose. Targets " +
      e.targets.join(', ').toLowerCase() + '.'
    : 'One exercise from Coach AJ\'s library each day at ' + brandName + ', with why it matters and how to do it. Free for everyone.';
  const graph = [{
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: brandName, item: siteUrl + '/' },
      { '@type': 'ListItem', position: 2, name: 'Exercise of the Day', item: siteUrl + EOTD_BASE },
    ].concat(e ? [{ '@type': 'ListItem', position: 3, name: e.name, item: url }] : []),
  }];
  if (e) {
    graph.push({
      '@type': 'HowTo',
      '@id': url + '#howto',
      name: e.name,
      description: e.why,
      datePublished: e.date,
      url,
      step: e.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
      publisher: { '@id': siteUrl + '/#organization' },
    });
  }
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return { url, title, desc, ld };
}

/* Fill the app shell (index.html, already branded) for an exercise
   page or the list: per-page title, description, canonical and
   social tags, the structured data, and the band itself, with the
   landing view opened on it so it shows before any script runs. */
function eotdShell(html, e, live, siteUrl, brandName) {
  const head = eotdHead(e, siteUrl, brandName);
  const t = esc(head.title);
  const d = esc(head.desc);
  const u = esc(head.url);
  const baseTitle = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || esc(brandName);
  return eotdHome(html
    .replace(/<html lang="en"/, '<html lang="en" data-base-title="' + baseTitle + '"')
    .replace(/<title>[^<]*<\/title>/, '<title>' + t + '</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + d + '">')
    .replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + u + '">')
    .replace(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="' + (e ? 'article' : 'website') + '">')
    .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + t + '">')
    .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + d + '">')
    .replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + u + '">')
    .replace(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + t + '">')
    .replace(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + d + '">')
    .replace('</head>', '<script type="application/ld+json" data-eotd-ld>' + head.ld + '</script>\n</head>')
    .replace('<section id="view-landing" class="view active lp">', '<section id="view-landing" class="view active lp" data-page="exercise">')
    .replace('<!--EOTD-PAGE-->', eotdPageBandHtml(e, live)), live);
}

/* The homepage band shows today's exercise; with none, it goes. */
function eotdHome(html, live) {
  const today = live[0];
  const withPage = html.replace('<!--EOTD-PAGE-->', '');
  if (!today) return withPage.replace(/<!--EOTD-BAND-START-->[\s\S]*?<!--EOTD-BAND-END-->/, '');
  return withPage
    .replace('<!--EOTD-BAND-START-->', '').replace('<!--EOTD-BAND-END-->', '')
    .replace('<!--EOTD-TODAY-->', eotdArticleHtml(today, { ownPageLink: true }));
}

/* Sitemap lines for the list and every exercise whose day has come. */
function eotdSitemap(live, siteUrl) {
  if (!live.length) return '';
  const line = (loc, mod) => '  <url>\n    <loc>' + esc(siteUrl + loc) + '</loc>\n    <lastmod>' + mod + '</lastmod>\n  </url>\n';
  return line(EOTD_BASE, live[0].date) + live.map(e => line(eotdPath(e), e.date)).join('');
}

/* Which exercise an address asks for: { list: true }, { slug }, or null. */
function eotdMatch(pathname) {
  const p = pathname.replace(/\/+$/, '');
  if (p === EOTD_BASE) return { list: true };
  const m = p.match(/^\/exercise-of-the-day\/([a-z0-9-]{1,80})$/);
  return m ? { slug: m[1] } : (p.startsWith(EOTD_BASE + '/') ? { slug: '' } : null);
}

module.exports = {
  EOTD_BASE, loadEotd, eotdLive, eotdArticleHtml, eotdPageBandHtml, eotdHead,
  eotdShell, eotdHome, eotdSitemap, eotdMatch, longDate,
};

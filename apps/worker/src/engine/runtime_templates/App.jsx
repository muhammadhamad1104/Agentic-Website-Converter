import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Save, LogOut, ExternalLink, Plus, Trash2, Upload, FileText, Image, Database, LockKeyhole, ArrowRight, Eye, EyeOff, ShieldAlert, ShieldCheck, Loader2, LayoutDashboard, Search, ChevronRight, ArrowLeft, Copy, Pencil, Check, X, Menu, Globe, FolderOpen, File, Music, Layers3 } from 'lucide-react';
import './style.css';

const sections = [['overview', 'Overview', LayoutDashboard], ['pages', 'Pages', FileText], ['media', 'Media library', Image], ['collections', 'Collections', Database]];
const fileName = item => {
  try { return decodeURIComponent(new URL(item.source || item.url, location.origin).pathname.split('/').pop()) || 'Asset'; }
  catch { return item.url; }
};
const formatDate = value => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '';
const displayValue = value => value == null ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value);

function App() {
  const [token, setToken] = useState(sessionStorage.getItem('admin-token') || '');
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(null);
  const [media, setMedia] = useState([]);
  const [schema, setSchema] = useState({ entities: [] });
  const [view, setView] = useState('overview');
  const [entity, setEntity] = useState('');
  const [records, setRecords] = useState([]);
  const [record, setRecord] = useState(null);
  const [values, setValues] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaType, setMediaType] = useState('all');
  const [fieldType, setFieldType] = useState('all');
  const [dirty, setDirty] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [defaultCredentials, setDefaultCredentials] = useState(false);
  const [site, setSite] = useState({ siteTitle: 'Your website', coverImage: '' });
  const uploadInput = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/config', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(config => { if (config) setSite(config); }).catch(() => {});
    return () => controller.abort();
  }, []);
  async function api(path, options = {}) {
    const response = await fetch('/api/admin' + path, {
      ...options, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...options.headers }
    });
    const body = await response.json();
    if (response.status === 401 && path !== '/login') { sessionStorage.removeItem('admin-token'); setToken(''); }
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body;
  }
  async function act(fn) {
    setBusy(true); setMessage(''); setError('');
    try { await fn(); } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!token) return;
    setLoaded(false);
    act(async () => {
      const [list, files, models, account] = await Promise.all([api('/pages'), api('/media'), api('/schema'), api('/account')]);
      setPages(list); setMedia(files); setSchema(models); setDefaultCredentials(account.defaultCredentials); setLoaded(true);
    });
  }, [token]);
  useEffect(() => {
    const before = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  function canLeave() { return !dirty || window.confirm('Discard unsaved changes?'); }
  function changeView(name) {
    if (busy || (name !== view && !canLeave())) return;
    if (name !== view) { setView(name); setPage(null); setRecord(null); setValues({}); setDirty(false); setMessage(''); setError(''); }
    setSidebarOpen(false);
  }
  async function selectPage(id) {
    if (busy || !canLeave()) return;
    await act(async () => {
      setPage(await api('/pages/' + id)); setView('pages'); setDirty(false); setSearch(''); setFieldType('all');
    });
  }
  async function savePage() {
    await act(async () => {
      await api('/pages/' + page.id, { method: 'PUT', body: JSON.stringify(page) });
      setPages(await api('/pages')); setDirty(false); setMessage('Saved');
    });
  }
  async function selectEntity(name) {
    if (busy || !canLeave()) return;
    await act(async () => {
      const rows = await api('/records/' + encodeURIComponent(name));
      setEntity(name); setRecords(rows); setRecord(null); setValues({}); setDirty(false);
    });
  }
  const change = update => { setPage(old => ({ ...old, ...update })); setDirty(true); };
  const changeField = (id, value) => change({ fields: page.fields.map(field => field.id === id ? { ...field, value } : field) });
  const published = pages.filter(item => item.published).length;
  const imageMedia = media.filter(item => item.type.startsWith('image/'));
  const currentSection = sections.find(item => item[0] === view);
  const entityFields = schema.entities.find(item => item.name === entity)?.fields || [];
  const tableFields = entityFields.slice(0, 3);
  const filteredPages = pages.filter(item => (item.title + item.route).toLowerCase().includes(pageSearch.toLowerCase()));
  const filteredMedia = media.filter(item => (fileName(item) + item.url).toLowerCase().includes(mediaSearch.toLowerCase()) &&
    (mediaType === 'all' || (mediaType === 'files' ? !/^(image|video|audio)\//.test(item.type) : item.type.startsWith(mediaType + '/'))));
  const visibleFields = page?.fields.filter(field => (field.label + field.value).toLowerCase().includes(search.toLowerCase()) &&
    (fieldType === 'all' || (fieldType === 'text' ? field.kind === 'text' : fieldType === 'media' ? ['src', 'poster'].includes(field.attribute) : field.attribute === 'href'))) || [];

  function pageTable(items) {
    return <div className="table-scroll"><table className="content-table"><thead><tr><th>Page</th><th>Status</th><th>Last updated</th><th><span className="sr-only">Open</span></th></tr></thead>
      <tbody>{items.map(item => <tr key={item.id}>
        <td><button className="page-link" disabled={busy} onClick={() => selectPage(item.id)}><span className="file-icon"><FileText size={18} /></span>
          <span><strong>{item.title || item.route}</strong><small>{item.route}</small></span></button></td>
        <td><span className={'badge ' + (item.published ? 'published' : 'draft')}><span />{item.published ? 'Published' : 'Draft'}</span></td>
        <td className="date-cell">{formatDate(item.updatedAt)}</td>
        <td><button className="icon-button" title={'Edit ' + item.title} aria-label={'Edit ' + item.title} disabled={busy} onClick={() => selectPage(item.id)}><ChevronRight size={17} /></button></td>
      </tr>)}</tbody></table>{!items.length && <div className="empty-state"><Search size={28} /><h3>No matching pages</h3></div>}</div>;
  }
  function mediaPreview(item) {
    if (item.type.startsWith('image/')) return <img src={item.url} alt={fileName(item)} loading="lazy" />;
    if (item.type.startsWith('video/')) return <video src={item.url} controls preload="metadata" />;
    if (item.type.startsWith('audio/')) return <div className="file-preview"><Music size={28} /><audio src={item.url} controls preload="metadata" /></div>;
    return <div className="file-preview"><File size={32} /><span>{item.type.split('/').pop()}</span></div>;
  }

  if (!token) return <div className="login-shell">
    <aside className="login-showcase">
      <a className="login-brand" href="/"><span className="login-brand-mark"><Layers3 size={21} /></span><span>Site administration</span></a>
      {site.coverImage ? <figure className="login-art"><img src={site.coverImage} alt="" /><figcaption>{site.siteTitle}</figcaption></figure> :
        <div className="login-art login-art-empty"><Layers3 size={54} strokeWidth={1} /><span>{site.siteTitle}</span></div>}
      <div className="login-showcase-footer"><span><ShieldCheck size={15} />Protected workspace</span><span>Content / Media / Collections</span></div>
    </aside>
    <main className="login-panel"><header className="login-mobile-header"><span className="admin-wordmark"><Layers3 size={19} />Site administration</span><a href="/"><ExternalLink size={15} />View website</a></header>
      <section className="login"><div className="login-emblem"><LockKeyhole size={24} /></div><p className="site-name">Administration</p><h1>{site.siteTitle}</h1><p className="login-intro">Sign in to manage your website.</p>
      <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        act(async () => { const result = await api('/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)) });
          sessionStorage.setItem('admin-token', result.token); setToken(result.token); setView('overview'); setPage(null); setDirty(false); });
      }}>
        <label htmlFor="admin-email">Email<input id="admin-email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required /></label>
        <label htmlFor="admin-password">Password</label>
        <div className="password-control"><input id="admin-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required />
          <button type="button" className="icon-button" title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="primary sign-in" disabled={busy}>{busy ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={16} />}{busy ? 'Signing in' : 'Sign in'}<ArrowRight size={17} /></button>
      </form>
      </section>
    </main>
  </div>;

  return <div className="admin-shell">
    {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className={'sidebar ' + (sidebarOpen ? 'open' : '')}>
      <div className="workspace-brand"><span className="brand-mark"><Layers3 size={19} /></span><div><strong>{site.siteTitle}</strong><small>Content workspace</small></div>
        <button className="icon-button mobile-only" title="Close navigation" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
      <p className="nav-label">Workspace</p>
      <nav aria-label="Admin sections">{sections.map(([name, title, Icon]) => <button key={name} aria-current={view === name ? 'page' : undefined} disabled={busy} onClick={() => changeView(name)}>
        <Icon size={18} /><span>{title}</span>{name === 'pages' && <small>{pages.length}</small>}{name === 'collections' && <small>{schema.entities.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><a href="/" target="_blank" rel="noreferrer"><Globe size={17} />View website<ExternalLink size={14} /></a>
        <div className="account"><span className="avatar">A</span><div><strong>Administrator</strong><small>Site management</small></div>
          <button className="icon-button" title="Sign out" aria-label="Sign out" disabled={busy} onClick={() => {
            if (!canLeave()) return;
            act(async () => { await api('/logout', { method: 'POST' }); sessionStorage.removeItem('admin-token'); setToken(''); setDirty(false); });
          }}><LogOut size={18} /></button></div></div>
    </aside>
    <div className="admin-main">
      <header className="topbar"><button className="icon-button mobile-only" title="Open navigation" aria-label="Open navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{currentSection[1]}</strong>{page && <><ChevronRight size={14} /><span className="breadcrumb-page">{page.title}</span></>}</div>
        <div className="topbar-actions"><span className="session-state"><span />Secure session</span><a href="/" target="_blank" rel="noreferrer" className="button quiet"><ExternalLink size={15} /><span>View website</span></a></div></header>
      <main className="main-content" aria-busy={busy}>
        {defaultCredentials && <p className="notice warning" role="status"><ShieldAlert size={17} />Default admin password active. Local setup only.</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {message && <p className="notice success" role="status"><Check size={16} />{message}</p>}
        {!loaded && <div className="empty-state"><Loader2 className="spin" size={24} /><h3>{error ? 'Workspace unavailable' : 'Loading workspace'}</h3></div>}
        {loaded && view === 'overview' && <>
          <div className="section-heading"><div><p className="eyebrow">Your workspace</p><h1>Overview</h1><p className="subtitle">{site.siteTitle}</p></div>
            <button className="primary" onClick={() => changeView('pages')}><FileText size={16} />Manage pages<ArrowRight size={16} /></button></div>
          <dl className="metrics">{[[FileText, 'Total pages', pages.length], [Globe, 'Published', published], [Pencil, 'Drafts', pages.length - published], [Image, 'Media assets', media.length]].map(([Icon, title, count]) =>
            <div key={title}><dt><Icon size={17} />{title}</dt><dd>{count}</dd></div>)}</dl>
          <div className="section-heading compact"><h2>Pages ({pages.length})</h2><button className="text-button" onClick={() => changeView('pages')}>View all<ArrowRight size={15} /></button></div>
          {pageTable(pages.slice(0, 6))}
          <div className="section-heading compact"><h2>Media library</h2><button className="text-button" onClick={() => changeView('media')}>View all<ArrowRight size={15} /></button></div>
          {imageMedia.length ? <div className="media-strip">{imageMedia.slice(0, 4).map(item => <button key={item.url} className="media-tile" onClick={() => changeView('media')}>
            <img src={item.url} alt={fileName(item)} loading="lazy" /><span>{fileName(item)}</span></button>)}</div> : <div className="empty-state small"><Image size={24} /><h3>No images</h3></div>}
        </>}
        {loaded && view === 'pages' && !page && <>
          <div className="section-heading"><div><p className="eyebrow">Content</p><h1>Pages ({pages.length})</h1></div><span className="muted">{published} published</span></div>
          <div className="filterbar"><div className="search-control"><Search size={17} /><input aria-label="Search pages" placeholder="Search pages" value={pageSearch} onChange={event => setPageSearch(event.target.value)} /></div><span className="muted">{filteredPages.length} pages</span></div>
          {pageTable(filteredPages)}
        </>}
        {loaded && view === 'pages' && page && <>
          <button className="text-button back-button" onClick={() => { if (canLeave()) { setPage(null); setDirty(false); } }}><ArrowLeft size={16} />All pages</button>
          <div className="section-heading editor-heading"><div><p className="eyebrow">Page editor</p><h1>{page.title}</h1><p className="subtitle">{page.route}</p></div>
            <div className="actions">{dirty && <span className="unsaved">Unsaved changes</span>}<a className="icon-button" title="Preview page" aria-label="Preview page" href={page.route} target="_blank" rel="noreferrer"><ExternalLink size={18} /></a>
              <button className="icon-button" title="Duplicate page" aria-label="Duplicate page" disabled={busy} onClick={() => {
                if (!canLeave()) return; const route = window.prompt('New page path', page.route.replace(/\/$/, '') + '-copy');
                if (route) act(async () => { const created = await api('/pages', { method: 'POST', body: JSON.stringify({ sourceId: page.id, route }) });
                  setPages(await api('/pages')); setPage(await api('/pages/' + created.id)); setDirty(false); setMessage('Draft created'); });
              }}><Copy size={17} /></button>
              <button className="icon-button danger" title="Delete page" aria-label="Delete page" disabled={busy} onClick={() => {
                if (window.confirm('Delete this page?')) act(async () => { await api('/pages/' + page.id, { method: 'DELETE' }); setPage(null); setPages(await api('/pages')); setDirty(false); setMessage('Page deleted'); });
              }}><Trash2 size={17} /></button><button className="primary" disabled={busy || !dirty} onClick={savePage}><Save size={16} />Save</button></div></div>
          <div className="editor-layout"><section className="editor-content">
            <div className="section-heading compact"><h2>Page content</h2><span className="muted">{visibleFields.length} fields</span></div>
            <div className="filterbar"><div className="segmented" aria-label="Content type">{['all', 'text', 'media', 'links'].map(type =>
              <button key={type} aria-pressed={fieldType === type} onClick={() => setFieldType(type)}>{type.charAt(0).toUpperCase() + type.slice(1)}</button>)}</div>
              <div className="search-control"><Search size={16} /><input aria-label="Filter content" placeholder="Filter content" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
            <div className="fields">{visibleFields.map(field => <div className="content-field" key={field.id}><label htmlFor={field.id}>{field.label}</label>
              {field.kind === 'text' ? <textarea id={field.id} aria-label={field.label} rows={Math.min(6, Math.max(2, Math.ceil(field.value.length / 100)))} value={field.value} onChange={event => changeField(field.id, event.target.value)} />
                : <input id={field.id} aria-label={field.label} value={field.value} onChange={event => changeField(field.id, event.target.value)} />}
              {field.attribute === 'src' && field.tag === 'img' && <img className="thumb" src={field.value} alt="" />}</div>)}
              {!visibleFields.length && <div className="empty-state small"><Search size={22} /><h3>No matching fields</h3></div>}</div>
          </section><aside className="page-settings"><h2>Page settings</h2>
            <label>Title<input value={page.title} onChange={event => change({ title: event.target.value })} /></label>
            <label>Path<input value={page.route} onChange={event => change({ route: event.target.value })} /></label>
            <div className="publish-row"><label className="check"><input type="checkbox" checked={page.published} onChange={event => change({ published: event.target.checked })} />Published</label><span className={'badge ' + (page.published ? 'published' : 'draft')}>{page.published ? 'Live' : 'Draft'}</span></div>
          </aside></div>
        </>}
        {loaded && view === 'media' && <>
          <div className="section-heading"><div><p className="eyebrow">Assets</p><h1>Media library</h1></div>
            <button className="primary" disabled={busy} onClick={() => uploadInput.current.click()}><Upload size={16} />Upload media</button>
            <input ref={uploadInput} className="sr-only" type="file" aria-label="Upload media file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,audio/mpeg" onChange={event => {
              const file = event.target.files[0]; event.target.value = ''; if (!file) return;
              act(async () => { const result = await api('/media', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
                setMedia(old => [{ url: result.url, type: file.type }, ...old]); setMessage('Media uploaded'); });
            }} /></div>
          <div className="filterbar"><div className="search-control"><Search size={17} /><input aria-label="Search media" placeholder="Search media" value={mediaSearch} onChange={event => setMediaSearch(event.target.value)} /></div>
            <select aria-label="Media type" value={mediaType} onChange={event => setMediaType(event.target.value)}>{[['all', 'All assets'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio'], ['files', 'Files']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="muted">{filteredMedia.length} assets</span></div>
          <div className="media-grid">{filteredMedia.map(item => <article className="media-item" key={item.url}><div className="media-preview">{mediaPreview(item)}</div>
            <div className="media-details"><div><strong title={fileName(item)}>{fileName(item)}</strong><small>{item.type}</small></div>
              <button className="icon-button" title="Copy asset URL" aria-label={'Copy URL for ' + fileName(item)} onClick={() => act(async () => { await navigator.clipboard.writeText(item.url); setMessage('Asset URL copied'); })}><Copy size={15} /></button>
              <a className="icon-button" href={item.url} title="Open asset" aria-label={'Open ' + fileName(item)} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a></div></article>)}</div>
          {!filteredMedia.length && <div className="empty-state"><FolderOpen size={30} /><h3>No matching assets</h3></div>}
        </>}
        {loaded && view === 'collections' && <>
          <div className="section-heading"><div><p className="eyebrow">Structured content</p><h1>Collections</h1></div><span className="muted">{schema.entities.length} collections</span></div>
          <div className="collection-layout"><aside className="collection-list"><h2>Collections</h2>{schema.entities.map(item => <button key={item.name} disabled={busy} aria-pressed={entity === item.name} onClick={() => selectEntity(item.name)}>
            <Database size={16} /><span>{item.name}<small>{item.fields.length} fields</small></span><ChevronRight size={15} /></button>)}</aside>
            <section className="collection-content">{entity ? <>
              <div className="section-heading compact"><div><h2>{entity}</h2><span className="muted">{records.length} records</span></div>
                <button disabled={busy} onClick={() => { if (canLeave()) { setRecord(null); setValues({}); setDirty(false); } }}><Plus size={16} />New record</button></div>
              <div className="table-scroll"><table className="content-table record-table"><thead><tr>{tableFields.map(field => <th key={field.name}>{field.name}</th>)}<th>Actions</th></tr></thead>
                <tbody>{records.map(row => <tr key={row.id} className={record?.id === row.id ? 'selected-row' : ''}>{tableFields.map(field => <td key={field.name}>{displayValue(row.data[field.name])}</td>)}
                  <td><div className="actions"><button className="icon-button" title="Edit record" aria-label={'Edit record ' + row.id} onClick={() => { if (canLeave()) { setRecord(row); setValues(row.data); setDirty(false); } }}><Pencil size={15} /></button>
                    <button className="icon-button danger" title="Delete record" aria-label={'Delete record ' + row.id} onClick={() => {
                      if (window.confirm('Delete this record?')) act(async () => { await api('/records/' + encodeURIComponent(entity) + '/' + row.id, { method: 'DELETE' });
                        if (record?.id === row.id) { setRecord(null); setValues({}); setDirty(false); } setRecords(await api('/records/' + encodeURIComponent(entity))); });
                    }}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>
              {!records.length && <div className="empty-state small"><Database size={23} /><h3>No records yet</h3></div>}
              <form className="record-form" onSubmit={event => { event.preventDefault(); act(async () => {
                const result = await api('/records/' + encodeURIComponent(entity) + (record ? '/' + record.id : ''), { method: record ? 'PUT' : 'POST', body: JSON.stringify(values) });
                if (!record) setRecord({ ...result, data: values });
                setRecords(await api('/records/' + encodeURIComponent(entity))); setDirty(false); setMessage('Record saved');
              }); }}><div className="section-heading compact"><h2>{record ? 'Edit record' : 'New record'}</h2>{dirty && <span className="unsaved">Unsaved changes</span>}</div>
                <div className="record-fields">{entityFields.map(field => {
                  const type = String(field.type).toLowerCase(); const numeric = ['int', 'integer', 'float', 'decimal', 'number'].includes(type); const boolean = ['bool', 'boolean'].includes(type);
                  return <label className={boolean ? 'check' : ''} key={field.name}>{field.name}<input type={boolean ? 'checkbox' : numeric ? 'number' : 'text'} step={numeric && !['int', 'integer'].includes(type) ? 'any' : undefined}
                    checked={boolean ? !!values[field.name] : undefined} value={boolean ? undefined : values[field.name] ?? ''}
                    onChange={event => { setValues(old => ({ ...old, [field.name]: boolean ? event.target.checked : numeric ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value })); setDirty(true); }} /></label>;
                })}</div><button className="primary" disabled={busy || !dirty}><Save size={16} />Save record</button></form>
            </> : <div className="empty-state"><Database size={30} /><h3>{schema.entities.length ? 'No collection selected' : 'No collections'}</h3></div>}</section>
          </div>
        </>}
      </main>
    </div>
  </div>;
}

const admin = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
createRoot(document.getElementById('root')).render(admin ? <App /> :
  <iframe title="Website" className="source-site" src={'/__site' + location.pathname + location.search + location.hash} />);

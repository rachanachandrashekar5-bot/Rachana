/*
 * TIMS Drawing Intelligence - on-device engine (Web Worker).
 *
 * Runs the extraction engine (Python, via Pyodide) and Tesseract OCR (WebAssembly)
 * inside the visitor's own browser. This worker only downloads its own engine
 * files from the site that served it; it never sends drawings, BOMs or results
 * anywhere. Inputs and results exist only in this browser tab's memory.
 */
'use strict';

const BASE = self.location.href.replace(/[^/]*$/, ''); // .../engine/
let manifest = null;
let pyodide = null;
let tess = null;
let tessApi = null;
let job = null;
let ready = null;

function status(detail) {
  self.postMessage({ type: 'status', detail });
}

async function fetchBytes(path) {
  const res = await fetch(BASE + path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not load ' + path);
  return new Uint8Array(await res.arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---- Tesseract (synchronous calls from Python) ---------------------------------
async function initTesseract() {
  importScripts(BASE + 'tesseract/' + manifest.tesseract.script);
  tess = await self.TesseractCore({ locateFile: (p) => BASE + 'tesseract/' + p });
  const data = await gunzip(await fetchBytes('tesseract/' + manifest.tesseract.data));
  tess.FS.writeFile('./eng.traineddata', data);
  tessApi = new tess.TessBaseAPI();
  if (tessApi.Init(null, 'eng', 1) !== 0) throw new Error('OCR engine failed to start');
}

self.tessTSV = function (pngBytes, psm, whitelist) {
  tess.FS.writeFile('/input', pngBytes);
  tessApi.SetVariable('tessedit_pageseg_mode', String(psm));
  tessApi.SetVariable('tessedit_char_whitelist', whitelist || '');
  if (tessApi.SetImageFile(1, 0) === 1) return '';
  tessApi.Recognize(null);
  return tessApi.GetTSVText(0) || '';
};

self.tessVersion = function () {
  return 'WebAssembly ' + (tessApi && tessApi.Version ? tessApi.Version() : '5');
};

// ---- Python engine --------------------------------------------------------------
async function initPython() {
  importScripts(BASE + 'pyodide/pyodide.js');
  status('Starting the processing engine');
  pyodide = await self.loadPyodide({ indexURL: BASE + 'pyodide/' });
  status('Loading image processing libraries');
  await pyodide.loadPackage(manifest.pyodide_packages, { messageCallback: () => {}, errorCallback: () => {} });
  for (const whl of manifest.wheels) {
    pyodide.unpackArchive(await fetchBytes('wheels/' + whl), 'wheel');
  }
  pyodide.unpackArchive(await fetchBytes(manifest.engine), 'zip', { extractDir: '/home/pyodide/engine' });
  pyodide.runPython(`
import sys
sys.path.insert(0, '/home/pyodide/engine')
import app.pytesseract_web as _tw
sys.modules['pytesseract'] = _tw
from app.browser_entry import BrowserJob, describe_error
`);
}

async function init() {
  manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('manifest.json')));
  status('Downloading the processing engine (first visit only)');
  await initPython();
  status('Loading text recognition');
  await initTesseract();
  // warm-up: compile the hot paths once so the first page is not slow
  pyodide.runPython('from app.services import ocr_engine as _o; _o._templates(); _o.tesseract_available()');
}

// ---- RPC ------------------------------------------------------------------------------
const methods = {
  async ready() {
    if (!ready) ready = init();
    await ready;
    return true;
  },
  newJob() {
    if (job) job.destroy();
    job = pyodide.globals.get('BrowserJob')();
    return true;
  },
  bomPlan(pageJson) { return job.bom_plan(pageJson); },
  bomAdd(pageJson, rgba, w, h, dpi, pageNo) { job.bom_add(pageJson, rgba, w, h, dpi, pageNo); return true; },
  bomFinish() { return job.bom_finish(); },
  drawingPlan(pageJson) { return job.drawing_plan(pageJson); },
  drawingAdd(pageJson, rgba, w, h, dpi, pageNo) { job.drawing_add(pageJson, rgba, w, h, dpi, pageNo); return true; },
  imagePageCount(bytes) { return job.image_page_count(bytes); },
  drawingAddImagePage(bytes, frame, pageNo) { job.drawing_add_image_page(bytes, frame, pageNo); return true; },
  finish(drawingName, bomName) {
    const res = job.finish(drawingName, bomName);
    const summary = res.get(0);
    const bytes = res.get(1);
    const xlsx = bytes.toJs();
    bytes.destroy();
    res.destroy();
    job.destroy();
    job = null;
    pyodide.runPython('import gc; gc.collect()');
    return { summary, xlsx };
  },
  drop() {
    if (job) { job.destroy(); job = null; }
    if (pyodide) pyodide.runPython('import gc; gc.collect()');
    return true;
  },
};

self.onmessage = async (e) => {
  const { id, method, args } = e.data || {};
  try {
    if (method !== 'ready' && !pyodide) await methods.ready();
    const result = await methods[method](...(args || []));
    if (result && result.xlsx) self.postMessage({ id, result }, [result.xlsx.buffer]);
    else self.postMessage({ id, result });
  } catch (err) {
    let info = null;
    try {
      // the Python job records a user-safe description of its last error
      const last = job && job.last_error;
      if (last) info = JSON.parse(String(last));
    } catch (_) { info = null; }
    if (!info) {
      const low = String((err && err.message) || err);
      info = /memory|out of bounds|allocation/i.test(low)
        ? { title: 'Drawing is too large for this device', message: 'Try a computer with more memory, or split the drawing into smaller files.' }
        : method === 'ready'
          ? { title: 'Unable to start the processing engine', message: 'Check your internet connection, then reload the page.' }
          : { title: 'Unable to process drawing', message: 'Please check that the files are readable and try again.' };
    }
    self.postMessage({ id, error: info });
  }
};

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:5177,strictPort:true}});
await server.listen();let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
 await page.route('**/__practice',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {default:Practice}=await import('/src/pages/specialist/MyPracticePilot.jsx');
const root=ReactDOM.createRoot(document.getElementById('root'));window.renderPractice=scope=>root.render(React.createElement(Practice,{key:scope,storageScope:scope,doctor:{name:scope}}));window.renderPractice('doctor-a:anmed');</script>`}));
 await page.goto('http://127.0.0.1:5177/__practice');
 await page.getByTestId('my-practice-places').waitFor();
 await page.getByTestId('mp-edit-place-demo-clinic-a').click();
 await page.getByTestId('mp-place-name').fill('Учебное место АнМед');
 await page.getByTestId('mp-place-form').getByRole('button',{name:'Сохранить место',exact:true}).click();
 await page.getByTestId('mp-save-places').click();
 await page.getByRole('button',{name:'Платные приёмы',exact:true}).click();
 await page.getByRole('button',{name:'Создать учебный слот',exact:true}).click();
 await page.locator('.mp-paid-slot').waitFor();
 const link=await page.getByRole('link',{name:'Посмотреть страницу пациента'}).getAttribute('href');
 assert.equal(new URL(link).searchParams.get('demoScope'),'doctor-a:anmed');
 await page.evaluate(()=>window.renderPractice('doctor-b:kgmu'));
 await page.getByTestId('my-practice-places').waitFor();
 assert.equal(await page.getByText('Учебное место АнМед',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Платные приёмы',exact:true}).click();
 assert.equal(await page.locator('.mp-paid-slot').count(),0);
 await page.evaluate(()=>window.renderPractice('doctor-a:anmed'));
 await page.getByText('Учебное место АнМед',{exact:true}).waitFor();
 await page.getByTestId('mp-delete-place-demo-clinic-a').click();
 await page.getByText(/Очистите их в разделе/).waitFor();
 await page.getByRole('button',{name:'Платные приёмы',exact:true}).click();
 await page.locator('.mp-paid-slot').waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS integrated practice: doctor/context draft separation, paid link scope, restored slots and deletion guard');
}finally{await browser?.close();await server.close();}

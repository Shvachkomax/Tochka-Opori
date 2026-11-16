// A3.6: Safe client-only tour metadata. It never submits medical or financial information.
export const TOUR_STEPS = Object.freeze([
  {id:"places",title:"Добавьте место работы",description:"Нажмите «Добавить место», укажите клинику или частную практику и нажмите «Сохранить». Пока это локальный справочник данного браузера.",target:'[data-tour-target="places"]',tab:"overview"},
  {id:"services",title:"Создайте услугу",description:"Нажмите «Добавить услугу», укажите название, стоимость (0 ₽ — бесплатная), формат и длительность, затем сохраните изменения.",target:'[data-tour-target="services"]',tab:"services"},
  {id:"calendar",title:"Настройте расписание",description:"Добавьте запись или занятость в календарь, затем сохраните календарь. Справочные события пока хранятся в этом браузере.",target:'[data-tour-target="calendar"]',tab:"calendar"},
]);
export const tourStorageKey = scope => "my-practice-tour-v1:"+String(scope||"public-demo");
export function tourStepReady(step,{places=0,offers=0,events=0,dirty=false,scheduleDirty=false}={}){
  if(step===0)return places>0&&!dirty;
  if(step===1)return offers>0&&!dirty;
  if(step===2)return events>0&&!scheduleDirty;
  return false;
}

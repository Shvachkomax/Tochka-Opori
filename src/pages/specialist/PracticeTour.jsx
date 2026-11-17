import React,{useEffect,useState} from "react";
import {TOUR_STEPS} from "../../../lib/my-practice/onboarding-tour.js";
import "./PracticeTour.css";

// Dock the guidance outside the cabinet when the viewport has a side gutter.
// The spotlight must never block the form or intercept clicks.
export default function PracticeTour({step,ready,targetOverride,instructionOverride,onNext,onSkip,onClose}){
  const item=TOUR_STEPS[step];
  const target=targetOverride||item.target;
  const [position,setPosition]=useState(null);
  useEffect(()=>{
    let frame=0;
    const measure=()=>{
      const el=document.querySelector(target);
      if(!el){setPosition(null);return;}
      const r=el.getBoundingClientRect();
      const panel=el.closest(".my-practice-pilot")?.getBoundingClientRect()||r;
      const width=Math.min(354,window.innerWidth-24);
      const gutter=16;
      const rightX=panel.right+gutter;
      const leftX=panel.left-width-gutter;
      const side=rightX+width+12<=window.innerWidth?"right":leftX>=12?"left":"top";
      const popStyle=side==="right"||side==="left"
        ?{top:Math.min(Math.max(12,r.top),Math.max(12,window.innerHeight-280)),left:side==="right"?rightX:leftX,bottom:"auto"}
        :{top:12,left:Math.max(12,window.innerWidth-width-12),bottom:"auto"};
      setPosition({
        highlight:{top:Math.max(0,r.top-7),left:Math.max(0,r.left-7),width:r.width+14,height:r.height+14},
        popStyle,side
      });
    };
    const el=document.querySelector(target);
    el?.scrollIntoView({behavior:"smooth",block:"center"});
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    update();window.addEventListener("resize",update);window.addEventListener("scroll",update,true);
    const timeout=setTimeout(update,400);
    const onKey=e=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",onKey);
    return ()=>{clearTimeout(timeout);cancelAnimationFrame(frame);window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);document.removeEventListener("keydown",onKey);};
  },[step,target,onClose]);
  return <>
    {position&&<div className="mp-tour-spotlight" aria-hidden="true" style={position.highlight}/>}
    <aside className={"mp-tour-popover mp-tour-placement-"+(position?.side||"top")} role="dialog" aria-modal="false" aria-label="Обучение по кабинету"
      style={position?.popStyle} data-testid="mp-tour-dialog">
      <div className="mp-tour-top"><span>Экскурсия · шаг {step+1} из {TOUR_STEPS.length}</span>
        <button type="button" onClick={onClose} aria-label="Закрыть обучение">×</button></div>
      <h3>{item.title}</h3><p>{instructionOverride||item.description}</p>
      <p className="mp-tour-status" role="status">{ready?"Шаг выполнен. Можно продолжить.":"Выполните действие и сохраните изменения либо пропустите этот шаг."}</p>
      <div className="mp-tour-actions">
        <button type="button" className="mp-secondary" onClick={onSkip}>Пропустить шаг</button>
        <button type="button" className="mp-primary" onClick={onNext} disabled={!ready} data-testid="mp-tour-next">{step===TOUR_STEPS.length-1?"Завершить":"Далее"}</button>
      </div>
    </aside>
  </>;
}

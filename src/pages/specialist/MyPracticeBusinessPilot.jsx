import React, { useMemo, useState } from "react";
import {filterOffers} from "../../../lib/my-practice/pilot-data.js";
import {
  quotePracticeCommission, simulatePracticeSettlement, formatPracticeRubles,
  MY_PRACTICE_DEFAULT_FEE_BPS,
} from "../../../lib/my-practice/commission.js";

export function MyPracticeFinancialDemo({catalog}) {
  const offers=useMemo(()=>filterOffers(catalog),[catalog]);
  const [selection,setSelection]=useState(offers[0]?.id||"");
  const [stage,setStage]=useState("unpaid");
  const [refundPercent,setRefundPercent]=useState("0");
  const chosen=offers.find(o=>o.id===selection)||offers[0]||null;
  const priceKopecks=chosen ? chosen.priceRub*100 : 0;
  const refundKopecks=Math.round(priceKopecks * Number(refundPercent) / 100);
  const quote=quotePracticeCommission(priceKopecks,MY_PRACTICE_DEFAULT_FEE_BPS);
  const result=simulatePracticeSettlement({
    grossPaidKopecks:priceKopecks,
    refundedKopecks:refundKopecks,
    paymentConfirmed:stage!=="unpaid",
    serviceCompleted:["completed","payable"].includes(stage),
    holdReleased:stage==="payable",
  });
  return <section className="mp-business" data-testid="my-practice-finance">
    <div className="mp-section-title">
      <h3>Комиссия платформы</h3>
      <p>Комиссия платформы: <strong>20%</strong> — расчёт без списания денег.</p>
    </div>
    <p className="mp-footnote">Расчёт без списания денег и выплат. Начисления за использование AI учитываются отдельно.</p>
    <div className="mp-business-filters">
      <label className="mp-field mp-field-block">Услуга из каталога
        <select data-testid="mp-finance-offer" value={chosen?.id||""} onChange={e=>setSelection(e.target.value)}
          disabled={!offers.length}>
          {offers.map(o=><option key={o.id} value={o.id}>{o.name} · {o.clinicName}</option>)}
        </select>
      </label>
    </div>
    {chosen ? <>
      <div className="mp-business-split">
        <div><span>Стоимость приёма</span><strong>{formatPracticeRubles(quote.priceKopecks)}</strong></div>
        <div><span>Комиссия платформы · 20%</span><strong>{formatPracticeRubles(quote.platformFeeKopecks)}</strong></div>
        <div><span>Исполнителю услуги · 80%</span><strong>{formatPracticeRubles(quote.organizationShareKopecks)}</strong></div>
      </div>
      <p className="mp-footnote">«Доля исполнителя» — расчётный остаток для юридически уполномоченного исполнителя (ИП или медицинской организации). Не является автоматическим личным гонораром врача; налоги и эквайринг не вычтены.</p>
      <div className="mp-business-scenario">
        <h4>Расчёт по состоянию сделки</h4>
        <label className="mp-field mp-field-block">Состояние сделки
          <select data-testid="mp-finance-stage" value={stage} onChange={e=>setStage(e.target.value)}>
            <option value="unpaid">Оплата не подтверждена</option>
            <option value="paid">Оплачено, услуга ещё не оказана</option>
            <option value="completed">Услуга оказана, срок удержания не завершён</option>
            <option value="payable">Услуга оказана, разрешён расчёт</option>
          </select>
        </label>
        <label className="mp-field mp-field-block">Возврат от оплаты
          <select value={refundPercent} onChange={e=>setRefundPercent(e.target.value)}>
            <option value="0">Без возврата</option>
            <option value="25">25% возврат</option>
            <option value="50">50% возврат</option>
            <option value="100">Полный возврат</option>
          </select>
        </label>
        <div className="mp-result" role="status">
          <span>{result.commissionStatus==="payable"?"Расчёт разрешён (пример)":result.commissionStatus==="held"?"Начисление на удержании (пример)":"Оплата не подтверждена"}</span>
          <strong>Доступная комиссия: {formatPracticeRubles(result.payablePlatformFeeKopecks)}</strong>
          <small>Оставшаяся расчётная комиссия после возврата: {formatPracticeRubles(result.net.platformFeeKopecks)}; сторнирование: {formatPracticeRubles(result.reversedFeeKopecks)}.</small>
        </div>
      </div>
    </> : <p className="mp-muted">Активных услуг нет. Добавьте услугу в разделе «Управление».</p>}
    <p className="mp-footnote">20% относятся к отдельной транзакции в разделе «Платные приёмы», но не к событиям справочного календаря. Реальная комиссия должна возникать только после подтверждения оплаты сервером, выполнения услуги и условий расчёта. При возврате — обратная запись по исходной ставке. При оплате напрямую в клинике автоматической комиссии у платформы нет без договорной сверки.</p>
  </section>;
}

const INVITE_STEPS=[
  {name:"Постоянная страница врача",detail:"Список мест приёма и услуг. Не даёт доступа к персональным данным."},
  {name:"Персональное приглашение",detail:"Врач создаёт одноразовую защищённую ссылку в своём кабинете Support; пациент сам принимает приглашение."},
  {name:"Кабинет пациента",detail:"После принятия связь со специалистом сохраняется в разрешённом контексте. Новая ссылка на каждое сообщение не нужна."},
  {name:"Запись в клинику",detail:"Переход в подтверждённый канал конкретной клиники. Реальные слоты и оплата подключаются только по согласованию."},
];
export function MyPracticePatientConnectionDemo() {
  return <section data-testid="my-practice-patient-connection">
    <div className="mp-section-title">
      <h3>Как врач подключает пациента</h3>
      <p>Пациент приходит по ссылке, подтверждает связь и затем взаимодействует со специалистом в личном кабинете.</p>
    </div>
    <div className="mp-link-flow">
      {INVITE_STEPS.map((item,i)=><div className="mp-link-step" key={item.name}>
        <span>{i+1}</span><div><strong>{item.name}</strong><p>{item.detail}</p></div>
      </div>)}
    </div>
    <div className="mp-next">
      <h4>Что уже работает в нашем Support</h4>
      <p>В авторизованном кабинете врача есть «Пригласить пациента». Сервер генерирует случайный токен,
        хранит только его хеш, ограничивает срок семью днями и допускает отзыв. Ссылка показывается один раз для копирования.</p>
      <p className="mp-footnote">Приглашение можно создать в уже существующем авторизованном кабинете Support. Эта публичная демостраница не создаёт настоящие ссылки.</p>
    </div>
    <div className="mp-warning" role="note">
      <strong>В этом демо ссылки не генерируются.</strong> Действующий механизм относится к Support,
      а не ко всем услугам «Моей практики». Нет автоматической записи в клиники, ссылок на оплату,
      медицинского документооборота или подключения Health-пациентов. Всё это отдельный защищённый этап.
    </div>
    <p className="mp-footnote">В реальном контуре приглашение должно иметь одноразовый серверный токен с истечением и отзывом, конкретный контекст врача/клиники, явное согласие пациента. Ссылки не должны содержать диагноз, ФИО, телефон, цену или другие персональные данные; для медицинских данных нужны дополнительные проверки доступа и правовые основания.</p>
  </section>;
}

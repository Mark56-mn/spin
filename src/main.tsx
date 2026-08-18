import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const STARTING_BALANCE = 10000;

type Mode = 'home' | 'low' | 'market' | 'duel';

function App() {
  const [mode, setMode] = React.useState<Mode>('home');
  const [balance, setBalance] = React.useState(STARTING_BALANCE);
  const [stake, setStake] = React.useState(500);
  const [result, setResult] = React.useState<string | null>(null);
  const [price, setPrice] = React.useState(100);
  const [marketSide, setMarketSide] = React.useState<'UP' | 'DOWN' | null>(null);
  const [time, setTime] = React.useState(15);

  React.useEffect(() => {
    if (mode !== 'market' || time <= 0) return;
    const id = setInterval(() => {
      setTime(t => Math.max(0, t - 1));
      setPrice(p => Math.max(70, p + (Math.random() - 0.47) * 1.8));
    }, 1000);
    return () => clearInterval(id);
  }, [mode, time]);

  function playLowRisk() {
    if (stake <= 0 || stake > balance) return;
    setBalance(b => b - stake);
    const win = crypto.getRandomValues(new Uint32Array(1))[0] % 100 < 50;
    const returned = win ? Math.round(stake * 1.9) : Math.round(stake * 0.9);
    setBalance(b => b + returned);
    setResult(win ? `WIN +${returned - stake} SPIN` : `LOSS -${stake - returned} SPIN`);
  }

  function enterMarket(side: 'UP' | 'DOWN') {
    if (stake > balance) return;
    setBalance(b => b - stake);
    setMarketSide(side);
    setResult(null);
    setTime(15);
    setPrice(100);
  }

  function finishMarket() {
    if (!marketSide) return;
    const won = marketSide === (price >= 100 ? 'UP' : 'DOWN');
    const returned = won ? stake * 2 : 0;
    setBalance(b => b + returned);
    setResult(won ? `MARKET WON +${stake} SPIN` : `MARKET LOST -${stake} SPIN`);
    setMarketSide(null);
  }

  React.useEffect(() => { if (mode === 'market' && time === 0 && marketSide) finishMarket(); }, [time]);

  return <div className="app">
    <header><button className="brand" onClick={() => setMode('home')}>SPIN<span>•</span></button><div className="balance"><small>BALANCE</small><strong>{balance.toLocaleString()} SPIN</strong></div></header>
    <main>
      {mode === 'home' && <>
        <section className="hero"><p className="eyebrow">PLAY THE ODDS</p><h1>Pick your<br/><em>side.</em></h1><p className="muted">A fast social prediction game. Practice with free SPIN credits.</p></section>
        <div className="games">
          <GameCard icon="🟢" title="Low Risk" desc="Limited downside. Up to +90%." tag="+90% / -10%" onClick={() => setMode('low')} />
          <GameCard icon="📈" title="Market" desc="Predict whether the market moves up or down." tag="UP / DOWN" onClick={() => setMode('market')} />
          <GameCard icon="⚔️" title="Duel" desc="Challenge a friend to a prediction battle." tag="SOON" disabled onClick={() => {}} />
        </div>
        <div className="notice">🎁 <b>10,000 SPIN</b> starter credits — no deposit required.</div>
      </>}

      {mode === 'low' && <GameShell title="Low Risk" subtitle="Your downside is limited to 10%.">
        <div className="risk-display"><div className="risk-circle">90<small>%</small><span>MAX UPSIDE</span></div><div><div className="stat"><b>+90%</b><span>WIN</span></div><div className="stat"><b>-10%</b><span>LOSS</span></div></div></div>
        <StakeInput stake={stake} setStake={setStake} balance={balance} />
        <button className="primary" onClick={playLowRisk}>SPIN NOW <span>→</span></button>
        {result && <Result text={result} />}
      </GameShell>}

      {mode === 'market' && <GameShell title="Market Arena" subtitle="Predict the direction of a fictional market.">
        <div className="market"><div className="market-head"><span>SPIN INDEX</span><b>{price.toFixed(2)}</b></div><div className="chart"><div className="line" style={{height:`${Math.min(92,Math.max(20,price-65))}%`}}></div><div className="gridline"/><div className="gridline two"/></div><div className="market-meta"><span>{marketSide ? `POSITION: ${marketSide}` : 'CHOOSE A DIRECTION'}</span><b>{marketSide ? `${time}s` : '15s ROUND'}</b></div></div>
        <StakeInput stake={stake} setStake={setStake} balance={balance} />
        <div className="direction"><button className={marketSide === 'UP' ? 'selected up' : 'up'} disabled={!!marketSide} onClick={() => enterMarket('UP')}>📈 UP</button><button className={marketSide === 'DOWN' ? 'selected down' : 'down'} disabled={!!marketSide} onClick={() => enterMarket('DOWN')}>📉 DOWN</button></div>
        {result && <Result text={result} />}
      </GameShell>}

      {mode === 'duel' && <GameShell title="Duel" subtitle="PvP matchmaking is next. The first build keeps the flow ready."><div className="coming">⚔️<h2>Challenge a friend</h2><p>Invite-code PvP is queued for the next build. Tonight, focus on mastering the core game engine.</p><button className="primary" onClick={() => setMode('home')}>BACK TO SPIN</button></div></GameShell>}
    </main>
    <footer><span>SPIN V1 • PLAY MONEY</span><span>Fair-play prototype</span></footer>
  </div>
}

function GameCard({icon,title,desc,tag,onClick,disabled}:{icon:string,title:string,desc:string,tag:string,onClick:()=>void,disabled?:boolean}) { return <button className={`game-card ${disabled?'disabled':''}`} onClick={onClick}><div className="icon">{icon}</div><div className="card-copy"><h2>{title}</h2><p>{desc}</p></div><span className="tag">{tag}</span><span className="arrow">→</span></button> }
function GameShell({title,subtitle,children}:{title:string,subtitle:string,children:React.ReactNode}) { return <section className="game-shell"><button className="back" onClick={()=>location.reload()}>← HOME</button><p className="eyebrow">SPIN ARENA</p><h1>{title}</h1><p className="muted">{subtitle}</p>{children}</section> }
function StakeInput({stake,setStake,balance}:{stake:number,setStake:(n:number)=>void,balance:number}) { return <div className="stake"><div><small>STAKE</small><strong>{stake.toLocaleString()} SPIN</strong></div><input type="range" min="100" max={Math.max(100,balance)} step="100" value={Math.min(stake,Math.max(100,balance))} onChange={e=>setStake(Number(e.target.value))}/><div className="quick"><button onClick={()=>setStake(Math.min(100,balance))}>100</button><button onClick={()=>setStake(Math.min(500,balance))}>500</button><button onClick={()=>setStake(Math.min(1000,balance))}>1K</button></div></div> }
function Result({text}:{text:string}) { return <div className={`result ${text.startsWith('WIN')||text.includes('WON')?'win':'loss'}`}>{text}</div> }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

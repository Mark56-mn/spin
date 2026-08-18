import { neon } from '@neondatabase/serverless';

export default async function handler(req:any,res:any){
  if(req.method!=='POST') return res.status(405).json({error:'POST required'});
  try{
    const userId=String(req.body?.userId||''); const stake=Number(req.body?.stake||0);
    if(!userId || !Number.isInteger(stake) || stake<100) return res.status(400).json({error:'Invalid player or stake'});
    if(!process.env.DATABASE_URL) return res.status(503).json({error:'DATABASE_URL is not configured'});
    const sql=neon(process.env.DATABASE_URL);
    const round=crypto.randomUUID();
    const won=crypto.getRandomValues(new Uint32Array(1))[0]%100<50;
    const profit=won?Math.round(stake*.9):-Math.round(stake*.1);
    const payout=won?stake+profit:stake+profit;
    const rows=await sql.transaction([
      sql`insert into game_rounds(id,game_type,status,seed_reveal) values(${round},'LOW_RISK','SETTLED','demo-server-rng') returning id`,
      sql`insert into game_entries(round_id,user_id,stake,choice,result,payout) values(${round},${userId},${stake},'SPIN',${won?'WIN':'LOSS'},${payout})`,
      sql`update wallets set balance=balance+${profit},updated_at=now() where user_id=${userId} and balance+${profit}>=0 returning balance`,
      sql`insert into ledger_entries(user_id,amount,entry_type,reference_id,metadata) values(${userId},${profit},'PAYOUT',${round},jsonb_build_object('game','LOW_RISK','stake',${stake},'result',${won?'WIN':'LOSS'}))`
    ]);
    const wallet=rows[2][0];
    if(!wallet) return res.status(409).json({error:'Insufficient balance'});
    return res.status(200).json({roundId:round,result:won?'WIN':'LOSS',profit,balance:Number(wallet.balance)});
  }catch(e){return res.status(500).json({error:'Round settlement failed'});}
}

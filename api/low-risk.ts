import { neon } from '@neondatabase/serverless';

export default async function handler(req:any,res:any){
  if(req.method!=='POST') return res.status(405).json({error:'POST required'});
  try{
    const userId=String(req.body?.userId||'');
    const stake=Number(req.body?.stake||0);
    if(!userId || !Number.isInteger(stake) || stake<100) return res.status(400).json({error:'Invalid player or stake'});
    if(!process.env.DATABASE_URL) return res.status(503).json({error:'DATABASE_URL is not configured'});
    const sql=neon(process.env.DATABASE_URL);
    const round=crypto.randomUUID();
    const won=crypto.getRandomValues(new Uint32Array(1))[0]%100<50;
    const profit=won?Math.round(stake*0.9):-Math.round(stake*0.1);
    const payout=stake+profit;
    const rows=await sql`
      with eligible as (
        select user_id from wallets where user_id=${userId} and balance >= ${stake} for update
      ), updated as (
        update wallets w set balance=w.balance+${profit},updated_at=now()
        from eligible e where w.user_id=e.user_id returning w.user_id,w.balance
      ), round_row as (
        insert into game_rounds(id,game_type,status,seed_reveal)
        select ${round},'LOW_RISK','SETTLED','server-rng' from updated returning id
      ), entry_row as (
        insert into game_entries(round_id,user_id,stake,choice,result,payout)
        select ${round},${userId},${stake},'SPIN',${won?'WIN':'LOSS'},${payout} from updated returning round_id
      )
      insert into ledger_entries(user_id,amount,entry_type,reference_id,metadata)
      select ${userId},${profit},'PAYOUT',${round},jsonb_build_object('game','LOW_RISK','stake',${stake},'result',${won?'WIN':'LOSS'}) from updated
      returning amount`;
    if(!rows.length) return res.status(409).json({error:'Insufficient balance'});
    const wallet=await sql`select balance from wallets where user_id=${userId}`;
    return res.status(200).json({roundId:round,result:won?'WIN':'LOSS',profit,balance:Number(wallet[0].balance)});
  }catch(e){return res.status(500).json({error:'Round settlement failed'});}
}

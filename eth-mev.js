/*
  This script takes transactions list from etherscan.io csv export made by certain address to the MEV-BOT
  and downloads tx receipts as well as analyzed the gas price compared to another transactions in the block
  to prove that it's private and out-of-order
  It also checks what miners placed this transactions out-of-order
  Saves results in output csv files
*/



"use strict";

//========== REQUIRE SECTION BEGIN
const web3 = require('web3');
const ObjectsToCsv = require('objects-to-csv');
//========== REQUIRE SECTION END

//const w3 = new web3('ws://13.49.229.242:8546'); // light node
const w3 = new web3('ws://16.170.110.11:8546'); // full node 

const data = require('./data/export.json');
const miners = require('./data/miners.json');

//========== MAIN SECTION BEGIN
async function main() {
  const outputArr = [];

  let i = 0;
  for (const el of data) {

    //i++; if (i > 50) { break; }

    const chain_data = {
      input: el,
      tx: null, 
      tx_receipt: null, 
      block: null
    }

    chain_data.tx = await w3.eth.getTransaction(el.Txhash);
    chain_data.tx_receipt = await w3.eth.getTransactionReceipt(el.Txhash);
    chain_data.block = await w3.eth.getBlock(chain_data.tx.blockNumber, true);

    const outItem = {
      tx_hash: chain_data.tx.hash,
      block_number: chain_data.tx.blockNumber,
      from: chain_data.tx.from,
      to: chain_data.tx.to,
      tx_nonce: chain_data.tx.nonce,
      tx_index: chain_data.tx.transactionIndex,
      n_txs_with_higher_gas_price: 0,
      tx_status: chain_data.tx_receipt.status,
      gas_price_gwei: w3.utils.fromWei(chain_data.tx.gasPrice, 'gwei') * 1.0,
      logs_number: chain_data.tx_receipt.logs.length,
      miner: chain_data.block.miner,
      miner_name: "",
      txs_per_block: chain_data.block.transactions.length,
      block_max_gas_price_gwei: 0,
      block_min_gas_price_gwei: Number.MAX_VALUE
    }

    //Check if miner name is known
    const mni = miners.findIndex(function(m) { return (m.address == outItem.miner); });
    if (mni >= 0) { outItem.miner_name = miners[mni].name; }
    
    //Find out block max/min gas price
    for (const tx of chain_data.block.transactions) {
      const gp = w3.utils.fromWei(tx.gasPrice, 'gwei') * 1.0;

      if (gp > outItem.block_max_gas_price_gwei) { outItem.block_max_gas_price_gwei = gp; }
      if (gp < outItem.block_min_gas_price_gwei) { outItem.block_min_gas_price_gwei = gp; }

      if (gp > outItem.gas_price_gwei) { outItem.n_txs_with_higher_gas_price++; }
    }

    // Add only those txs that comes in the beginning of the block out of order and are successful
    if ((outItem.tx_status) && 
        (outItem.tx_index < outItem.n_txs_with_higher_gas_price) && 
        (outItem.logs_number > 1)) 
    {
      outputArr.push(outItem);
    }

    log_inline(`${outItem.tx_hash} / ${outItem.tx_nonce}`);
  }

  const csv1 = new ObjectsToCsv(outputArr);
  const csv1FileName = `./result_txs_${Date.now()}.csv`;
  await csv1.toDisk(csv1FileName);
  log(`Txs data is saved to disk to ${csv1FileName}`);

  // Check how powerful are the miners that included arbitrage txs into the blocks out of order
  const srv = {
    start_block: Number.MAX_VALUE,
    end_block: 0,
    unique_miners: []
  }
  
  for (const item of outputArr) {
    if (item.block_number < srv.start_block) { srv.start_block = item.block_number; }
    if (item.block_number > srv.end_block) { srv.end_block = item.block_number; }

    // Build unique miners array
    const mi = srv.unique_miners.findIndex(function(m) { return (m.miner == item.miner); });
    if (mi < 0) { 
      const unique_miners_item = {
        block_range: null,
        total_blocks: 0,
        miner: item.miner, 
        miner_name: item.miner_name, 
        mined_blocks: 0,
        pct: 0
      }
      srv.unique_miners.push(unique_miners_item); }
  }

  for (let b = srv.start_block; b <= srv.end_block; b++) {
    log_inline(`Block ${b} out of range [${srv.start_block} - ${srv.end_block}]`);

    const b_tmp = await w3.eth.getBlock(b, false);

    const mi = srv.unique_miners.findIndex(function(m) { return (m.miner == b_tmp.miner); });
    if (mi >= 0) {
      srv.unique_miners[mi].block_range = `${srv.start_block} - ${srv.end_block}`;
      srv.unique_miners[mi].total_blocks = srv.end_block - srv.start_block;
      srv.unique_miners[mi].mined_blocks++;
      srv.unique_miners[mi].pct = ((srv.unique_miners[mi].mined_blocks / srv.unique_miners[mi].total_blocks) * 100).toFixed(0);
    }
  }

  const csv2 = new ObjectsToCsv(srv.unique_miners);
  const csv2FileName = `./result_miners_${Date.now()}.csv`;
  await csv2.toDisk(csv2FileName);
  log(`Miners data is saved to disk to ${csv2FileName}`);

  w3.currentProvider.disconnect();
  log('Finished');
}

main();
//========== MAIN SECTION END


//========== SUPPORT FUNCTIONS SECTION BEGIN
function log(msg) {
  process.stdout.clearLine();
  console.log(msg);
}

function log_inline(msg) {
  process.stdout.clearLine();
  process.stdout.write(`${msg}\r`);
}
//========== SUPPORT FUNCTIONS SECTION END



const { parentPort, workerData } = require("worker_threads");
var current_tst=null;

parentPort.on('message', (msg) => {
 current_tst=msg;
});


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
var terminating=false;
async function demo() {
  var c1=current_tst;
  await sleep(workerData.num)
  var c2=current_tst;
  if (c1==c2) {
	  console.log("log: TERMINATING:"+(c2-c1));
	  parentPort.close();
	  parentPort.postMessage("ERROR?");
	  terminating=true;
  } else {
	 // console.log("log: OK:"+(c2-c1));
  }
  waiting=false;
}

async function monitoring() {
	console.log("start monitoring...");
	while (!terminating) {
		await demo();
	}
}

monitoring();
const AutonomousCodingAgent = require('../server/autonomous-coding-agent.cjs');

async function test() {
  const agent = new AutonomousCodingAgent();
  const testFile = 'app/runtime-state/test-agent-scratch.txt';
  
  agent.writeFile(testFile, 'Agent Self-Test Active');
  const readBack = agent.readFile(testFile);
  
  if (readBack !== 'Agent Self-Test Active') {
    throw new Error('Agent file read/write failed');
  }

  const loopResult = await agent.executeTaskLoop('Agent Echo Test', 'node -e "process.exit(0)"', 2);
  if (!loopResult.success) throw new Error('Agent loop failed verification');

  console.log('PASS: Autonomous Coding Agent Loop successfully executed self-test verification.');
}

test().catch(e => {
  console.error('FAIL: Autonomous Coding Agent error:', e.message);
  process.exit(1);
});

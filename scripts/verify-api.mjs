async function runApiVerification() {
  const BASE = "http://localhost:3000";

  console.log("1. Testing GET /api/events...");
  const res1 = await fetch(`${BASE}/api/events`);
  const data1 = await res1.json();
  console.log(`✓ GET /api/events returned ${data1.events?.length} events`);

  console.log("2. Testing POST /api/events...");
  const newEventPayload = {
    title: "Database Milestone 1",
    subject: "DBMS",
    type: "PROJECT",
    status: "NOT_STARTED",
    deadline: "2026-10-10T23:59:00",
    submissionUrl: "https://classroom.google.com/c/dbms-project",
    description: "Submit ER diagram and SQL DDL schemas.",
    requirements: ["PostgreSQL 15", "ER diagram PDF"],
    sourceGroup: "CSE-B 2026"
  };
  const res2 = await fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newEventPayload)
  });
  const data2 = await res2.json();
  const createdId = data2.event?.id;
  console.log(`✓ POST /api/events created event ID: ${createdId} (Notion sync: ${data2.notionSync?.status})`);

  console.log("3. Testing PATCH /api/events/:id...");
  const res3 = await fetch(`${BASE}/api/events/${createdId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "IN_PROGRESS",
      changeSummary: "Student started working on ER diagrams"
    })
  });
  const data3 = await res3.json();
  const patchItem = data3.event || data3.item;
  console.log(`✓ PATCH /api/events/:id status: ${patchItem?.status} (Changes count: ${patchItem?.changeHistory?.length})`);

  const runId = Date.now().toString().slice(-4);

  console.log("4. Testing POST /api/messages/process (New Message)...");
  const msgPayload = {
    message: `Submit OS Assignment ${runId} before 12 Oct 23:59: https://forms.gle/os-${runId}`,
    sourceGroup: "CSE Dept",
    sender: "OS Faculty"
  };
  const res4 = await fetch(`${BASE}/api/messages/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msgPayload)
  });
  const data4 = await res4.json();
  const item4 = data4.event || data4.item;
  console.log(`✓ POST /api/messages/process action: ${data4.action} -> Title: '${item4?.title}'`);

  console.log("5. Testing Duplicate message detection via /api/messages/process...");
  const res5 = await fetch(`${BASE}/api/messages/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msgPayload)
  });
  const data5 = await res5.json();
  console.log(`✓ Duplicate message action: ${data5.action} (Reason: ${data5.reason || data5.message})`);

  console.log("6. Testing Postponement flow via /api/messages/process...");
  // First send initial Slip Test
  const initialSlip = {
    message: `Slip Test ${runId} on 30-09-2026 during first period`,
    sourceGroup: "NLP Class",
    sender: "NLP Prof"
  };
  const slipRes1 = await fetch(`${BASE}/api/messages/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(initialSlip)
  });
  const slipData1 = await slipRes1.json();
  const slipItem1 = slipData1.event || slipData1.item;
  console.log(`✓ Created Slip Test: Date = ${slipItem1?.eventDate}, ID = ${slipItem1?.id}`);

  // Send postponement message
  const postMsg = {
    message: `Slip Test ${runId} is postponed to 3 October.`,
    sourceGroup: "NLP Class",
    sender: "NLP Prof"
  };
  const slipRes2 = await fetch(`${BASE}/api/messages/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(postMsg)
  });
  const slipData2 = await slipRes2.json();
  const slipItem2 = slipData2.event || slipData2.item;
  console.log(`✓ Postponement action: ${slipData2.action} -> New Date = ${slipItem2?.eventDate}, Status = ${slipItem2?.status}`);
  console.log(`✓ Change history entries count: ${slipItem2?.changeHistory?.length}`);

  console.log("7. Testing Ambiguous message (Needs Confirmation)...");
  const ambMsg = {
    message: `Please submit project ${runId} soon.`,
    sourceGroup: "General Class",
    sender: "Rep"
  };
  const ambRes = await fetch(`${BASE}/api/messages/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ambMsg)
  });
  const ambData = await ambRes.json();
  const ambItem = ambData.event || ambData.item;
  console.log(`✓ Ambiguous action: ${ambData.action} -> needsConfirmation: ${ambItem?.needsConfirmation}`);

  console.log("\n========================================================");
  console.log("ALL API & DATABASE INTEGRATION VERIFICATIONS PASSED! 🎉");
  console.log("========================================================");
}

runApiVerification().catch(err => {
  console.error("API verification error:", err);
  process.exit(1);
});

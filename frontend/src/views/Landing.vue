<template>
  <div class="container center-hero">
    <h1>Split the pot.<br />Track every rupee.</h1>
    <p>
      One person collects a fixed amount from everyone going on the trip.
      YOLO keeps a shared, honest ledger of who's paid in, what's been spent,
      and what's left — no accounts, no sign-in, just a code.
    </p>
    <div class="choice-grid">
      <div class="card">
        <h3>Start a new trip</h3>
        <p>Set the destination, the currency, and how much each person chips in.</p>
        <button @click="$router.push('/create')">Create a trip</button>
      </div>
      <div class="card">
        <h3>Join with a code</h3>
        <p>Already got a YOLO code from whoever's holding the money?</p>
        <button class="ghost" @click="$router.push('/join')">Enter YOLO code</button>
      </div>
    </div>
  </div>
</template>

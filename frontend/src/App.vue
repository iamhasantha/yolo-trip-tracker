<template>
  <div class="topbar">
    <div class="container topbar-inner">
      <router-link to="/" style="text-decoration:none; color:inherit;">
        <span class="brand">YOLO<span class="dot">.</span></span>
      </router-link>
      <span class="mono" style="color:var(--ink-soft); font-size:0.85rem;">trip budgets, kept honest</span>
    </div>
  </div>
  <router-view />
</template>

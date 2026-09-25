<template>
  <div class="topbar">
    <div class="container topbar-inner">
      <router-link to="/" style="text-decoration:none; color:inherit;">
        <span class="brand">YOLO<span class="dot">.</span></span>
      </router-link>
      <div class="topbar-actions">
        <span class="mono topbar-tagline">No more "figure it out later."</span>
        <router-link v-if="tripCode" :to="{ name: 'trip-settings', params: { code: tripCode } }" class="settings-nav" :class="{ active: route.name === 'trip-settings' }" aria-label="Trip settings" title="Trip settings">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M10 2h4l.5 2.2c.6.2 1.2.5 1.7.9l2.1-.9 2.8 2.8-.9 2.1c.4.5.7 1.1.9 1.7L23 10v4l-2.2.5c-.2.6-.5 1.2-.9 1.7l.9 2.1-2.8 2.8-2.1-.9c-.5.4-1.1.7-1.7.9L14 23h-4l-.5-2.2c-.6-.2-1.2-.5-1.7-.9l-2.1.9-2.8-2.8.9-2.1c-.4-.5-.7-1.1-.9-1.7L1 14v-4l2.2-.5c.2-.6.5-1.2.9-1.7l-.9-2.1 2.8-2.8 2.1.9c.5-.4 1.1-.7 1.7-.9L10 2Z" />
          </svg>
          <span>Settings</span>
        </router-link>
      </div>
    </div>
  </div>
  <router-view />
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const tripCode = computed(() => typeof route.params.code === "string" ? route.params.code : "");
</script>

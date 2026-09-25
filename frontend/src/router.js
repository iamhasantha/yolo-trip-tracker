import { createRouter, createWebHistory } from "vue-router";
import Landing from "./views/Landing.vue";
import CreateTrip from "./views/CreateTrip.vue";
import JoinTrip from "./views/JoinTrip.vue";
import Dashboard from "./views/Dashboard.vue";
import Settings from "./views/Settings.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Landing },
    { path: "/create", component: CreateTrip },
    { path: "/join", component: JoinTrip },
    { path: "/trip/:code", component: Dashboard, props: true },
    { path: "/trip/:code/settings", name: "trip-settings", component: Settings, props: true },
  ],
});

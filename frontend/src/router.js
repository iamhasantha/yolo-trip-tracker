import { createRouter, createWebHistory } from "vue-router";
import Landing from "./views/Landing.vue";
import CreateTrip from "./views/CreateTrip.vue";
import JoinTrip from "./views/JoinTrip.vue";
import Dashboard from "./views/Dashboard.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Landing },
    { path: "/create", component: CreateTrip },
    { path: "/join", component: JoinTrip },
    { path: "/trip/:code", component: Dashboard, props: true },
  ],
});

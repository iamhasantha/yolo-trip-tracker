<template>
  <section v-if="slides.length" class="priority-slideshow" aria-label="Priority notes slideshow" @mouseenter="paused = true" @mouseleave="paused = false" @focusin="paused = true" @focusout="onFocusOut">
    <div class="priority-slideshow-heading">
      <h3><span aria-hidden="true">✦</span> Priority notes</h3>
      <span class="mono priority-count">{{ activeIndex + 1 }} / {{ slides.length }}</span>
    </div>
    <Transition name="slide-fade" mode="out-in">
      <article v-if="activeSlide" :key="activeSlide.id" class="priority-slide" :class="`note-${activeSlide.color}`" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd" @touchcancel="onTouchCancel">
        <p class="priority-slide-content">{{ activeSlide.content }}</p>
        <span class="priority-slide-author">{{ activeSlide.author_name }} · {{ formatDate(activeSlide.created_at) }}</span>
      </article>
    </Transition>
    <div v-if="slides.length > 1" class="priority-dots" role="group" aria-label="Choose priority note">
      <button v-for="(slide, index) in slides" :key="slide.id" type="button" class="priority-dot" :class="{ active: activeIndex === index }" :aria-label="`Show priority note ${index + 1} of ${slides.length}`" :aria-current="activeIndex === index ? 'true' : undefined" @click="activeIndex = index"></button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { colorNotes } from "../noteColors.js";

const props = defineProps({ notes: { type: Array, default: () => [] }, code: String });
const slides = computed(() => colorNotes(props.notes, 1, props.code));
const activeIndex = ref(0);
const activeSlide = computed(() => slides.value[activeIndex.value] || slides.value[0]);
const autoplay = ref(false);
const paused = ref(false);
const touching = ref(false);
let touchStart = null;

watch(slides, (items) => {
  if (activeIndex.value >= items.length) activeIndex.value = 0;
});

watch(() => props.notes.map((note) => note.id).join(","), () => {
  activeIndex.value = 0;
});

watch([slides, autoplay, paused, touching], ([items, shouldPlay, isPaused, isTouching], _previous, onCleanup) => {
  if (!shouldPlay || isPaused || isTouching || items.length < 2) return;
  const timer = setInterval(() => { activeIndex.value = (activeIndex.value + 1) % items.length; }, 5000);
  onCleanup(() => clearInterval(timer));
}, { immediate: true });

function onFocusOut(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) paused.value = false;
}

function onTouchStart(event) {
  const touch = event.touches[0];
  if (!touch) return;
  touchStart = { x: touch.clientX, y: touch.clientY };
  touching.value = true;
}

function onTouchEnd(event) {
  const start = touchStart;
  touchStart = null;
  touching.value = false;
  const end = event.changedTouches[0];
  if (!start || !end || slides.value.length < 2) return;

  const horizontal = end.clientX - start.x;
  const vertical = end.clientY - start.y;
  if (Math.abs(horizontal) < 45 || Math.abs(horizontal) <= Math.abs(vertical) * 1.25) return;
  const direction = horizontal < 0 ? 1 : -1;
  activeIndex.value = (activeIndex.value + direction + slides.value.length) % slides.value.length;
}

function onTouchCancel() {
  touchStart = null;
  touching.value = false;
}

function formatDate(value) { return new Date(value + "Z").toLocaleDateString(); }

onMounted(() => {
  autoplay.value = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
});
</script>

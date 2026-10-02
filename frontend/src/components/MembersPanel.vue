<template>
  <div>
    <div v-if="canEdit && !locked" class="card" style="margin-bottom:1.4em;">
      <h3>Add a member</h3>
      <p>Set a temporary 4-digit PIN and share it with them. They can change it after signing in.</p>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <form @submit.prevent="add" class="actions-row">
        <input v-model="name" placeholder="Member name" style="max-width:260px;" required />
        <input v-model="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="4-digit PIN" aria-label="Temporary 4-digit PIN" style="max-width:180px;" required />
        <button type="submit" :disabled="loading">Add</button>
      </form>
    </div>

    <section class="card leadership-card">
      <div class="leadership-heading">
        <div>
          <h3>Trip leader</h3>
          <p>Members can request the role and vote. A candidate needs more than half of all trip members to become leader.</p>
        </div>
        <span class="leader-majority mono">Majority: {{ leadership.requiredVotes }} of {{ leadership.memberCount }}</span>
      </div>
      <p v-if="leadership.leader" class="current-leader"><span aria-hidden="true">★</span> Current leader: <strong>{{ leadership.leader.name }}</strong></p>
      <p v-else class="current-leader">No leader has been elected yet.</p>
      <p v-if="leadershipNotice" class="success-banner leader-notice" role="status">{{ leadershipNotice }}</p>
      <p v-if="leadershipError" class="error-banner leader-notice" role="alert">{{ leadershipError }}</p>
      <div v-if="leadership.candidates.length" class="leadership-ballot">
        <div v-for="candidate in leadership.candidates" :key="candidate.member_id" class="leader-candidate">
          <div class="leader-candidate-info">
            <strong>{{ candidate.name }}</strong>
            <span class="mono">{{ candidate.votes }} / {{ leadership.requiredVotes }} votes</span>
          </div>
          <button v-if="canEdit && !locked" type="button" class="ghost leader-vote-button" :disabled="leadershipBusy || leadership.myVoteCandidateId === candidate.member_id" @click="voteFor(candidate)">
            {{ leadership.myVoteCandidateId === candidate.member_id ? "Your vote" : leadership.myVoteCandidateId ? "Change vote" : "Vote" }}
          </button>
        </div>
      </div>
      <p v-else class="no-leader-candidates">No active candidates. Request to become the leader to start an election.</p>
      <button v-if="canEdit && !locked" type="button" class="leader-request-button" :class="{ ghost: isCandidate }" :disabled="leadershipBusy" @click="isCandidate ? withdrawRequest() : requestToLead()">
        {{ leadershipBusy ? "Please wait…" : isCandidate ? "Withdraw leader request" : "Ask to become leader" }}
      </button>
    </section>

    <div v-if="members.length === 0" class="empty-state">No members yet — add the first one above.</div>
    <table v-else>
      <thead><tr><th>Name</th><th>Joined</th><th></th></tr></thead>
      <tbody>
        <template v-for="m in members" :key="m.id">
          <tr>
            <td>{{ m.name }}</td>
            <td class="mono" style="color:var(--ink-soft); font-size:0.85rem;">{{ formatDate(m.joined_at) }}</td>
            <td>
              <div v-if="canEdit && !locked" class="member-actions">
                <button v-if="m.id !== memberId && leadership.leader?.member_id === memberId" class="ghost" style="padding:0.3em 0.7em; font-size:0.8rem;" @click="togglePinReset(m.id)">
                  {{ resetMemberId === m.id ? "Cancel PIN reset" : "Reset PIN" }}
                </button>
                <button class="danger" style="padding:0.3em 0.7em; font-size:0.8rem;" @click="remove(m.id)">Remove</button>
              </div>
            </td>
          </tr>
          <tr v-if="resetMemberId === m.id">
            <td colspan="3">
              <form class="member-pin-reset" @submit.prevent="resetPin(m)">
                <div class="member-pin-reset-copy">
                  <label :for="`reset-pin-${m.id}`">Set a new 4-digit PIN for {{ m.name }}</label>
                  <small>Share this PIN with them so they can sign in, then ask them to change it in Settings.</small>
                </div>
                <input :id="`reset-pin-${m.id}`" v-model="newPin" type="text" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="4-digit PIN" required />
                <button type="submit" :disabled="resetting">{{ resetting ? "Saving…" : "Save new PIN" }}</button>
              </form>
              <p v-if="resetSuccess" class="success-banner member-pin-success" role="status">{{ resetSuccess }}</p>
              <p v-if="resetError" class="error-banner member-pin-error" role="alert">{{ resetError }}</p>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String, locked: Boolean, canEdit: Boolean, memberId: Number });
const emit = defineEmits(["changed"]);

const members = ref([]);
const name = ref("");
const pin = ref("");
const loading = ref(false);
const error = ref("");
const resetMemberId = ref(null);
const newPin = ref("");
const resetting = ref(false);
const resetSuccess = ref("");
const resetError = ref("");
const leadership = ref({ leader: null, candidates: [], memberCount: 0, requiredVotes: 1, myVoteCandidateId: null });
const leadershipBusy = ref(false);
const leadershipError = ref("");
const leadershipNotice = ref("");
const isCandidate = computed(() => leadership.value.candidates.some((candidate) => candidate.member_id === props.memberId));

function formatDate(d) { return new Date(d + "Z").toLocaleDateString(); }

async function load() {
  const [memberList, status] = await Promise.all([api.listMembers(props.code), api.leadership(props.code)]);
  members.value = memberList;
  leadership.value = status;
}

async function requestToLead() {
  leadershipBusy.value = true;
  leadershipError.value = "";
  leadershipNotice.value = "";
  try {
    leadership.value = await api.requestLeadership(props.code);
    leadershipNotice.value = "Your request is on the ballot. Members can now vote for you.";
  } catch (e) {
    leadershipError.value = e.message;
  } finally {
    leadershipBusy.value = false;
  }
}

async function withdrawRequest() {
  leadershipBusy.value = true;
  leadershipError.value = "";
  leadershipNotice.value = "";
  try {
    leadership.value = await api.withdrawLeadership(props.code);
    leadershipNotice.value = "Your leader request was withdrawn.";
  } catch (e) {
    leadershipError.value = e.message;
  } finally {
    leadershipBusy.value = false;
  }
}

async function voteFor(candidate) {
  leadershipBusy.value = true;
  leadershipError.value = "";
  leadershipNotice.value = "";
  try {
    const result = await api.voteForLeader(props.code, candidate.member_id);
    leadership.value = result;
    leadershipNotice.value = result.elected
      ? `${result.elected.name} has been elected trip leader by majority vote.`
      : `Your vote for ${candidate.name} has been recorded.`;
  } catch (e) {
    leadershipError.value = e.message;
  } finally {
    leadershipBusy.value = false;
  }
}

async function add() {
  error.value = "";
  loading.value = true;
  try {
    await api.addMember(props.code, name.value.trim(), pin.value);
    name.value = "";
    pin.value = "";
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function remove(id) {
  if (!confirm("Remove this member? Their contributions and expenses stay on record.")) return;
  await api.removeMember(props.code, id);
  await load();
  emit("changed");
}

function togglePinReset(id) {
  resetMemberId.value = resetMemberId.value === id ? null : id;
  newPin.value = "";
  resetSuccess.value = "";
  resetError.value = "";
}

async function resetPin(member) {
  resetting.value = true;
  resetSuccess.value = "";
  resetError.value = "";
  try {
    await api.resetMemberPin(props.code, member.id, newPin.value);
    resetSuccess.value = `PIN updated for ${member.name}. Share the new PIN with them so they can sign in.`;
  } catch (e) {
    resetError.value = e.message;
  } finally {
    resetting.value = false;
  }
}

onMounted(load);
</script>

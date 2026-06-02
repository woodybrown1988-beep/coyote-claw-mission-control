(function () {
  'use strict';

  var STORAGE_KEY = 'planflow-mission-control-v1';
  var app = document.getElementById('app');
  var nowTimer = null;
  var state = loadState();

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDaysISO(days) {
    var date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function formatDay(iso) {
    var date = new Date(iso + 'T12:00:00');
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function minutesLabel(minutes) {
    var value = Number(minutes) || 0;
    if (value >= 60) {
      var hours = Math.floor(value / 60);
      var rest = value % 60;
      return rest ? hours + 'h ' + rest + 'm' : hours + 'h';
    }
    return value + 'm';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.tasks)) {
        return normalizeState(saved);
      }
    } catch (_) {
      // Fall through to seeded state.
    }
    return seedState();
  }

  function normalizeState(saved) {
    var seeded = seedState();
    return {
      view: saved.view || 'today',
      query: saved.query || '',
      selectedTaskId: saved.selectedTaskId || (saved.tasks[0] && saved.tasks[0].id),
      focusTaskId: saved.focusTaskId || null,
      focusRunning: false,
      focusSeconds: saved.focusSeconds || 0,
      projects: saved.projects && saved.projects.length ? saved.projects : seeded.projects,
      tasks: saved.tasks.map(normalizeTask),
      calendarBlocks: saved.calendarBlocks && saved.calendarBlocks.length ? saved.calendarBlocks : seeded.calendarBlocks,
      routines: saved.routines || seeded.routines,
      reviews: saved.reviews || [],
      prefs: Object.assign({}, seeded.prefs, saved.prefs || {})
    };
  }

  function normalizeTask(task) {
    return Object.assign({
      id: uid('task'),
      title: 'Untitled task',
      projectId: '',
      area: '',
      due: '',
      day: '',
      time: '',
      estimate: 30,
      priority: 'p3',
      energy: 'medium',
      status: 'Inbox',
      labels: [],
      notes: '',
      checklist: [],
      blockedBy: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, task);
  }

  function seedState() {
    var product = uid('project');
    var ops = uid('project');
    var home = uid('project');
    var today = todayISO();
    return {
      view: 'today',
      query: '',
      selectedTaskId: '',
      focusTaskId: null,
      focusRunning: false,
      focusSeconds: 0,
      prefs: {
        dailyCapacity: 360,
        energyNow: 'medium',
        confirmImportantMoves: true
      },
      projects: [
        { id: product, name: 'Launch Plan', area: 'Work', color: '#26547c', status: 'Active', lastReviewed: addDaysISO(-2) },
        { id: ops, name: 'Operations', area: 'Work', color: '#1f8a5b', status: 'Active', lastReviewed: addDaysISO(-10) },
        { id: home, name: 'Personal Admin', area: 'Life', color: '#6a55bf', status: 'Active', lastReviewed: addDaysISO(-4) }
      ],
      tasks: [
        normalizeTask({ id: uid('task'), title: 'Write launch memo draft', projectId: product, due: today, day: today, time: '09:30', estimate: 90, priority: 'p1', energy: 'high', status: 'Ready', labels: ['writing'], notes: 'Start with risks and decision needed.' }),
        normalizeTask({ id: uid('task'), title: 'Triage overdue vendor contract', projectId: ops, due: addDaysISO(-1), estimate: 45, priority: 'p1', energy: 'medium', status: 'Ready', labels: ['legal'] }),
        normalizeTask({ id: uid('task'), title: 'Make QA checklist actionable', projectId: product, due: today, day: today, estimate: 50, priority: 'p2', energy: 'medium', status: 'Ready', checklist: ['Define smoke path', 'Assign owner', 'Add release blocker rule'] }),
        normalizeTask({ id: uid('task'), title: 'Send receipts to accountant', projectId: home, due: addDaysISO(2), estimate: 25, priority: 'p3', energy: 'low', status: 'Inbox' }),
        normalizeTask({ id: uid('task'), title: 'Waiting for design signoff', projectId: product, due: addDaysISO(1), estimate: 30, priority: 'p2', energy: 'low', status: 'Waiting', blockedBy: 'Design lead approval' }),
        normalizeTask({ id: uid('task'), title: 'Review weekly routines', projectId: home, due: addDaysISO(5), estimate: 20, priority: 'p4', energy: 'low', status: 'Ready', labels: ['routine'] })
      ],
      calendarBlocks: [
        { id: uid('block'), day: today, start: '10:30', end: '11:00', title: 'Team standup' },
        { id: uid('block'), day: today, start: '12:30', end: '13:00', title: 'Lunch buffer' },
        { id: uid('block'), day: today, start: '15:00', end: '16:00', title: 'Customer call' }
      ],
      routines: [
        { id: uid('routine'), title: 'Plan tomorrow', cadence: 'weekday', estimate: 10 },
        { id: uid('routine'), title: 'Inbox zero pass', cadence: 'daily', estimate: 15 }
      ],
      reviews: []
    };
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function icon(name) {
    var paths = {
      add: '<path d="M12 5v14M5 12h14"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      calendar: '<path d="M8 3v4M16 3v4M4 9h16M5 5h14v16H5z"/>',
      focus: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
      defer: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
      filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
      inbox: '<path d="M4 5h16l-2 14H6z"/><path d="M4 13h5l2 3h2l2-3h5"/>',
      plan: '<path d="M5 4h14v17H5z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
      review: '<path d="M5 12l4 4L19 6"/><path d="M4 20h16"/>',
      play: '<path d="M8 5v14l11-7z"/>',
      pause: '<path d="M8 5v14M16 5v14"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/>'
    };
    return '<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.plan) + '</svg></span>';
  }

  function render() {
    var selectedTask = getSelectedTask();
    app.innerHTML = [
      '<div class="planner">',
      renderSidebar(),
      '<main class="main">',
      renderCommandBar(),
      renderView(),
      '</main>',
      renderInspector(selectedTask),
      '</div>',
      renderBottomNav(),
      renderFocusMode(),
    ].join('');
    bindDragAndDrop();
    maintainFocusTimer();
  }

  function renderSidebar() {
    var counts = getCounts();
    var quality = planQuality();
    return [
      '<aside class="sidebar">',
      '<div class="brand"><span class="brand-mark">' + icon('plan') + '</span><span class="brand-title"><strong>Planflow</strong><span>Execution cockpit</span></span></div>',
      '<nav class="nav-group">',
      '<span class="nav-label">Surfaces</span>',
      navButton('today', 'focus', 'Today', counts.today),
      navButton('inbox', 'inbox', 'Inbox', counts.inbox),
      navButton('plan', 'calendar', 'Plan', counts.planned),
      navButton('review', 'review', 'Review', quality.items.length),
      '</nav>',
      '<div class="nav-group"><span class="nav-label">Projects</span>',
      state.projects.map(function (project) {
        return '<button class="nav-item" data-project="' + project.id + '"><span class="project-dot" style="background:' + project.color + '"></span><span>' + escapeHtml(project.name) + '</span><span class="nav-count">' + projectTaskCount(project.id) + '</span></button>';
      }).join(''),
      '</div>',
      '<div class="sidebar-footer"><div class="mini-stat"><span>Plan quality</span><strong>' + quality.score + '%</strong></div><div class="quality-strip"><i style="width:' + quality.score + '%"></i></div></div>',
      '</aside>'
    ].join('');
  }

  function navButton(view, iconName, label, count) {
    return '<button class="nav-item ' + (state.view === view ? 'active' : '') + '" data-view="' + view + '">' + icon(iconName) + '<span>' + label + '</span><span class="nav-count">' + count + '</span></button>';
  }

  function renderCommandBar() {
    return [
      '<div class="command-bar">',
      '<form class="capture" data-capture-form><span>' + icon('add') + '</span><input name="capture" autocomplete="off" placeholder="Capture: write report tomorrow 2h p1 #launch @Launch Plan"><button class="btn primary" type="submit">Add</button></form>',
      '<label class="search">' + icon('search') + '<input data-search value="' + escapeHtml(state.query) + '" placeholder="Search tasks, labels"></label>',
      '<button class="btn" data-action="start-next">' + icon('focus') + 'Now</button>',
      '</div>'
    ].join('');
  }

  function renderView() {
    if (state.view === 'inbox') return renderInboxView();
    if (state.view === 'plan') return renderPlanView();
    if (state.view === 'review') return renderReviewView();
    return renderTodayView();
  }

  function renderTodayView() {
    var capacity = capacitySummary(todayISO());
    var quality = planQuality();
    var next = nextBestTask();
    var overdue = activeTasks().filter(function (task) { return task.due && task.due < todayISO(); });
    var planned = todayTasks();
    return [
      '<section class="view">',
      renderViewHead('Today', 'A realistic plan, a short focus queue, and a way to recover when the day changes.', [
        '<button class="btn" data-action="pull-due">' + icon('calendar') + 'Pull due</button>',
        '<button class="btn" data-action="reschedule-missed">' + icon('defer') + 'Reschedule missed</button>',
        '<button class="btn" data-action="make-realistic">' + icon('filter') + 'Make realistic</button>',
        '<button class="btn primary" data-action="start-next">' + icon('focus') + 'Start Now</button>'
      ]),
      '<div class="dashboard-grid">',
      '<div class="stack">',
      '<section class="panel"><div class="panel-head"><h2>Daily planning</h2><span>must, due, realistic</span></div><div class="panel-body planning-flow">',
      flowCard('1. Must happen', next ? 'Next best task: ' + next.title : 'Pick one task from the queue and make it the next action.', 'start-next', 'Start Now'),
      flowCard('2. Due and overdue', overdue.length + ' overdue and ' + dueToday().length + ' due today. Pull them in before choosing extras.', 'pull-due', 'Pull due'),
      flowCard('3. Workload check', capacity.usedLabel + ' planned against ' + capacity.availableLabel + '. ' + capacity.message, 'make-realistic', 'Fix plan'),
      '</div></section>',
      '<section class="panel"><div class="panel-head"><h2>Focus queue</h2><span>' + planned.length + ' active</span></div><div class="panel-body"><div class="task-list">' + renderTaskList(planned, 'No tasks planned for today. Pull due work or capture one task to begin.') + '</div></div></section>',
      '<section class="panel"><div class="panel-head"><h2>Calendar blocks</h2><span>today</span></div><div class="panel-body">' + renderTimeline() + '</div></section>',
      '</div>',
      '<div class="stack">',
      '<section class="panel"><div class="panel-head"><h2>Capacity</h2><span>prevents overplanning</span></div><div class="panel-body">' + renderCapacityMeter(capacity) + '</div></section>',
      '<section class="panel"><div class="panel-head"><h2>Plan Quality Engine</h2><span>' + quality.score + '%</span></div><div class="panel-body">' + renderQualityItems(quality.items) + '</div></section>',
      '<section class="panel"><div class="panel-head"><h2>Overdue triage</h2><span>' + overdue.length + '</span></div><div class="panel-body"><div class="task-list">' + renderTaskList(overdue, 'No overdue tasks. Keep the plan narrow.') + '</div></div></section>',
      '<section class="panel"><div class="panel-head"><h2>Routines</h2><span>habit-light</span></div><div class="panel-body">' + renderRoutines() + '</div></section>',
      '</div>',
      '</div>',
      '</section>'
    ].join('');
  }

  function flowCard(title, body, action, label) {
    return '<div class="flow-card"><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(body) + '</p><button class="btn" data-action="' + action + '">' + escapeHtml(label) + '</button></div>';
  }

  function renderInboxView() {
    var inbox = filteredTasks().filter(function (task) { return task.status === 'Inbox'; });
    return [
      '<section class="view">',
      renderViewHead('Inbox', 'Fast capture first. Only the title is required; fields can be inferred or refined later.', [
        '<button class="btn primary" data-action="create-empty">' + icon('add') + 'New task</button>'
      ]),
      '<div class="inbox-layout">',
      '<section class="panel"><div class="panel-head"><h2>Captured tasks</h2><span>' + inbox.length + '</span></div><div class="panel-body"><div class="task-list">' + renderTaskList(inbox, 'Inbox is clear. Capture a messy task from the command bar.') + '</div></div></section>',
      '<section class="panel"><div class="panel-head"><h2>Quick fields</h2><span>optional</span></div><div class="panel-body"><form class="review-form" data-quick-task>' + quickTaskFields() + '<button class="btn primary" type="submit">' + icon('add') + 'Capture task</button></form></div></section>',
      '</div>',
      '</section>'
    ].join('');
  }

  function quickTaskFields() {
    return [
      '<label class="field"><span>Title</span><input name="title" required placeholder="Call Alex about launch risk"></label>',
      '<div class="field-grid">',
      '<label class="field"><span>Project</span><select name="projectId">' + projectOptions('') + '</select></label>',
      '<label class="field"><span>Area</span><input name="area" placeholder="Work, Life, Health"></label>',
      '<label class="field"><span>Due</span><input type="date" name="due"></label>',
      '<label class="field"><span>Estimate</span><input name="estimate" placeholder="45m or 2h"></label>',
      '<label class="field"><span>Priority</span><select name="priority">' + priorityOptions('p3') + '</select></label>',
      '<label class="field"><span>Energy</span><select name="energy">' + energyOptions('medium') + '</select></label>',
      '<label class="field"><span>Status</span><select name="status">' + statusOptions('Inbox') + '</select></label>',
      '</div>'
    ].join('');
  }

  function renderPlanView() {
    var days = Array.from({ length: 7 }, function (_, index) { return addDaysISO(index); });
    return [
      '<section class="view">',
      renderViewHead('Plan', 'Drag tasks into days, check capacity, and expose blocked project work.', [
        '<button class="btn" data-action="make-realistic">' + icon('filter') + 'Make week realistic</button>',
        '<button class="btn primary" data-action="create-empty">' + icon('add') + 'Add task</button>'
      ]),
      '<div class="plan-board">',
      days.map(renderDayColumn).join(''),
      '</div>',
      '<section class="panel"><div class="panel-head"><h2>Projects at risk</h2><span>blocked and stale</span></div><div>' + renderProjects() + '</div></section>',
      '</section>'
    ].join('');
  }

  function renderDayColumn(day) {
    var tasks = filteredTasks().filter(function (task) { return task.day === day && task.status !== 'Done'; });
    var cap = capacitySummary(day);
    return [
      '<div class="day-column" data-day="' + day + '">',
      '<div class="day-head"><strong>' + escapeHtml(formatDay(day)) + '</strong><span>' + cap.usedLabel + '</span></div>',
      '<div class="day-cap"><i style="width:' + Math.min(cap.percent, 100) + '%"></i></div>',
      renderTaskList(tasks, 'Drop tasks here to plan this day.'),
      '</div>'
    ].join('');
  }

  function renderReviewView() {
    var quality = planQuality();
    var reviews = state.reviews.slice(-4).reverse();
    return [
      '<section class="view">',
      renderViewHead('Review', 'Short shutdowns and weekly checks that produce concrete next actions.', [
        '<button class="btn" data-action="pull-due">' + icon('calendar') + 'Prepare tomorrow</button>'
      ]),
      '<div class="review-grid">',
      '<section class="panel"><div class="panel-head"><h2>Daily shutdown</h2><span>keep, move, drop, adjust</span></div><div class="panel-body"><form class="review-form" data-review-form>',
      reviewField('done', 'Done', 'What actually got finished?'),
      reviewField('moved', 'Moved', 'What moved and why?'),
      reviewField('dropped', 'Dropped', 'What no longer matters?'),
      reviewField('learned', 'Learned', 'What should change tomorrow?'),
      '<button class="btn primary" type="submit">' + icon('check') + 'Save shutdown</button>',
      '</form></div></section>',
      '<div class="stack">',
      '<section class="panel"><div class="panel-head"><h2>Weekly review</h2><span>direct suggestions</span></div><div class="panel-body">' + renderQualityItems(quality.items) + '</div></section>',
      '<section class="panel"><div class="panel-head"><h2>Recent shutdowns</h2><span>' + reviews.length + '</span></div><div class="panel-body">' + (reviews.length ? reviews.map(renderReviewNote).join('') : '<div class="empty-state"><strong>No shutdown saved yet.</strong><span>End the day with one short review.</span></div>') + '</div></section>',
      '</div>',
      '</div>',
      '</section>'
    ].join('');
  }

  function reviewField(name, label, placeholder) {
    return '<label class="field"><span>' + label + '</span><textarea name="' + name + '" placeholder="' + placeholder + '"></textarea></label>';
  }

  function renderReviewNote(review) {
    return '<div class="review-note"><strong>' + escapeHtml(formatDay(review.day)) + '</strong><span>Done: ' + escapeHtml(review.done || 'none noted') + '</span><span>Adjust: ' + escapeHtml(review.learned || 'none noted') + '</span></div>';
  }

  function renderViewHead(title, subtitle, actions) {
    return '<header class="view-head"><div class="view-title"><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(subtitle) + '</p></div><div class="toolbar">' + actions.join('') + '</div></header>';
  }

  function renderCapacityMeter(capacity) {
    var level = capacity.percent > 105 ? 'danger' : capacity.percent > 85 ? 'warn' : '';
    return '<div class="capacity"><div class="capacity-top"><span>Planned load</span><strong>' + capacity.usedLabel + ' / ' + capacity.availableLabel + '</strong></div><div class="meter"><i class="' + level + '" style="width:' + Math.min(capacity.percent, 100) + '%"></i></div><span>' + escapeHtml(capacity.message) + '</span></div>';
  }

  function renderQualityItems(items) {
    if (!items.length) {
      return '<div class="empty-state"><strong>Plan looks realistic.</strong><span>No overloaded days, stale projects, or orphaned priority work detected.</span></div>';
    }
    return '<div class="quality-list">' + items.map(function (item) {
      return '<div class="quality-item ' + item.level + '"><span>' + icon(item.level === 'danger' ? 'filter' : 'review') + '</span><div><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.detail) + '</span></div></div>';
    }).join('') + '</div>';
  }

  function renderTaskList(tasks, emptyText) {
    if (!tasks.length) {
      return '<div class="empty-state"><strong>' + escapeHtml(emptyText) + '</strong><span>No blank dead end here: capture, pull due work, or drag from another day.</span></div>';
    }
    return tasks.map(renderTaskCard).join('');
  }

  function renderTaskCard(task) {
    var project = getProject(task.projectId);
    var done = task.status === 'Done';
    return [
      '<article class="task-card ' + task.priority + ' ' + (state.selectedTaskId === task.id ? 'selected' : '') + ' ' + (done ? 'done' : '') + '" draggable="true" data-task-id="' + task.id + '">',
      '<div class="task-title"><button class="complete-dot ' + (done ? 'done' : '') + '" data-action="toggle-done" data-id="' + task.id + '" title="Complete">' + (done ? icon('check') : '') + '</button><strong>' + escapeHtml(task.title) + '</strong></div>',
      '<div class="task-actions">',
      '<button class="btn icon-only" data-action="focus-task" data-id="' + task.id + '" title="Focus">' + icon('focus') + '</button>',
      '<button class="btn icon-only" data-action="schedule-today" data-id="' + task.id + '" title="Schedule today">' + icon('calendar') + '</button>',
      '<button class="btn icon-only" data-action="defer-task" data-id="' + task.id + '" title="Defer">' + icon('defer') + '</button>',
      '</div>',
      '<div class="task-meta">',
      '<span class="badge priority-' + task.priority + '">' + task.priority.toUpperCase() + '</span>',
      '<span class="badge energy-' + task.energy + '">' + escapeHtml(task.energy) + '</span>',
      '<span class="badge status-' + task.status + '">' + escapeHtml(task.status) + '</span>',
      task.estimate ? '<span class="badge">' + minutesLabel(task.estimate) + '</span>' : '',
      task.area ? '<span class="badge">' + escapeHtml(task.area) + '</span>' : '',
      task.checklist && task.checklist.length ? '<span class="badge">' + task.checklist.length + ' steps</span>' : '',
      task.due ? '<span class="badge">Due ' + escapeHtml(task.due) + '</span>' : '',
      project ? '<span class="badge"><span class="project-dot" style="background:' + project.color + '"></span>' + escapeHtml(project.name) + '</span>' : '',
      task.blockedBy ? '<span class="badge status-Waiting">Blocked by ' + escapeHtml(task.blockedBy) + '</span>' : '',
      task.labels.map(function (label) { return '<span class="badge">#' + escapeHtml(label) + '</span>'; }).join(''),
      '</div>',
      '</article>'
    ].join('');
  }

  function renderTimeline() {
    var hours = Array.from({ length: 11 }, function (_, index) { return 8 + index; });
    var today = todayISO();
    return '<div class="timeline">' + hours.map(function (hour) {
      var label = String(hour).padStart(2, '0') + ':00';
      var blocks = state.calendarBlocks.filter(function (block) { return block.day === today && Number(block.start.slice(0, 2)) === hour; });
      var tasks = todayTasks().filter(function (task) { return task.time && Number(task.time.slice(0, 2)) === hour; });
      return '<div class="time-row"><div class="time-label">' + label + '</div><div class="time-slot" data-slot="' + label + '">' + blocks.map(function (block) {
        return '<div class="block">' + icon('calendar') + '<span>' + escapeHtml(block.start + '-' + block.end + ' ' + block.title) + '</span></div>';
      }).join('') + tasks.map(function (task) {
        return '<div class="block task-block" data-task-id="' + task.id + '">' + icon('focus') + '<span>' + escapeHtml(task.time + ' ' + task.title) + '</span></div>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  function renderProjects() {
    return state.projects.map(function (project) {
      var tasks = activeTasks().filter(function (task) { return task.projectId === project.id; });
      var next = tasks.find(function (task) { return task.status === 'Ready' && !task.blockedBy; });
      var blocked = tasks.filter(function (task) { return task.blockedBy || task.status === 'Waiting'; }).length;
      return '<div class="project-row"><span class="project-dot" style="background:' + project.color + '"></span><div><strong>' + escapeHtml(project.name) + '</strong><span>' + tasks.length + ' active tasks, ' + blocked + ' blocked, next action: ' + escapeHtml(next ? next.title : 'missing') + '</span></div><button class="btn" data-action="project-next" data-project="' + project.id + '">Next</button></div>';
    }).join('');
  }

  function renderRoutines() {
    return '<div class="task-list">' + state.routines.map(function (routine) {
      return '<article class="task-card"><div class="task-title">' + icon('review') + '<strong>' + escapeHtml(routine.title) + '</strong></div><div class="task-actions"><button class="btn" data-action="add-routine" data-id="' + routine.id + '">Add</button></div><div class="task-meta"><span class="badge">' + escapeHtml(routine.cadence) + '</span><span class="badge">' + minutesLabel(routine.estimate) + '</span></div></article>';
    }).join('') + '</div>';
  }

  function renderInspector(task) {
    if (!task) {
      return '<aside class="inspector"><div class="empty-state"><strong>Select a task</strong><span>Details, notes, dependencies, and checklist controls appear here.</span></div></aside>';
    }
    return [
      '<aside class="inspector" data-inspector>',
      '<div class="inspector-head"><button class="btn icon-only mobile-inspector-close" data-action="close-inspector">' + icon('defer') + '</button><h2>' + escapeHtml(task.title) + '</h2><p>' + escapeHtml(task.status) + ' in ' + escapeHtml((getProject(task.projectId) || {}).name || 'No project') + '</p></div>',
      '<form class="inspector-body" data-inspector-form data-id="' + task.id + '">',
      '<label><span>Title</span><input name="title" value="' + escapeHtml(task.title) + '"></label>',
      '<div class="field-grid">',
      '<label><span>Project</span><select name="projectId">' + projectOptions(task.projectId) + '</select></label>',
      '<label><span>Area</span><input name="area" value="' + escapeHtml(task.area) + '"></label>',
      '<label><span>Status</span><select name="status">' + statusOptions(task.status) + '</select></label>',
      '<label><span>Due</span><input type="date" name="due" value="' + escapeHtml(task.due) + '"></label>',
      '<label><span>Planned day</span><input type="date" name="day" value="' + escapeHtml(task.day) + '"></label>',
      '<label><span>Time</span><input type="time" name="time" value="' + escapeHtml(task.time) + '"></label>',
      '<label><span>Estimate minutes</span><input type="number" min="0" name="estimate" value="' + escapeHtml(task.estimate) + '"></label>',
      '<label><span>Priority</span><select name="priority">' + priorityOptions(task.priority) + '</select></label>',
      '<label><span>Energy</span><select name="energy">' + energyOptions(task.energy) + '</select></label>',
      '</div>',
      '<label><span>Blocked by</span><input name="blockedBy" value="' + escapeHtml(task.blockedBy) + '" placeholder="Dependency, person, or decision"></label>',
      '<label><span>Labels</span><input name="labels" value="' + escapeHtml(task.labels.join(', ')) + '" placeholder="writing, legal, routine"></label>',
      '<label><span>Notes and checklist</span><textarea name="notes" placeholder="Notes, links, and next action">' + escapeHtml(task.notes) + '</textarea></label>',
      '<label><span>Checklist</span><textarea name="checklist" placeholder="One checklist item per line">' + escapeHtml((task.checklist || []).join('\n')) + '</textarea></label>',
      '<div class="inspector-actions"><button class="btn primary" type="submit">' + icon('check') + 'Save</button><button class="btn" type="button" data-action="focus-task" data-id="' + task.id + '">' + icon('focus') + 'Focus</button><button class="btn" type="button" data-action="delete-task" data-id="' + task.id + '">' + icon('trash') + 'Delete</button></div>',
      '</form>',
      '</aside>'
    ].join('');
  }

  function renderBottomNav() {
    return '<nav class="bottom-nav">' + [
      mobileNav('today', 'focus', 'Today'),
      mobileNav('inbox', 'inbox', 'Inbox'),
      mobileNav('plan', 'calendar', 'Plan'),
      mobileNav('review', 'review', 'Review')
    ].join('') + '</nav>';
  }

  function mobileNav(view, iconName, label) {
    return '<button class="' + (state.view === view ? 'active' : '') + '" data-view="' + view + '">' + icon(iconName) + '<span>' + label + '</span></button>';
  }

  function renderFocusMode() {
    var task = state.focusTaskId ? getTask(state.focusTaskId) : null;
    if (!task) {
      return '<div class="focus-overlay" data-focus-overlay></div>';
    }
    return [
      '<div class="focus-overlay open" data-focus-overlay>',
      '<section class="focus-card">',
      '<button class="btn" data-action="close-focus">Close</button>',
      '<h2>' + escapeHtml(task.title) + '</h2>',
      '<div class="focus-meta"><span class="badge priority-' + task.priority + '">' + task.priority.toUpperCase() + '</span><span class="badge energy-' + task.energy + '">' + escapeHtml(task.energy) + '</span><span class="badge">' + minutesLabel(task.estimate) + '</span></div>',
      '<div class="focus-timer">' + formatTimer(state.focusSeconds) + '</div>',
      '<div class="focus-actions">',
      '<button class="btn primary" data-action="toggle-focus">' + icon(state.focusRunning ? 'pause' : 'play') + (state.focusRunning ? 'Pause' : 'Start') + '</button>',
      '<button class="btn" data-action="complete-focus">' + icon('check') + 'Complete</button>',
      '<button class="btn" data-action="defer-focus">' + icon('defer') + 'Defer</button>',
      '</div>',
      '</section>',
      '</div>'
    ].join('');
  }

  function projectOptions(selected) {
    return '<option value="">No project</option>' + state.projects.map(function (project) {
      return '<option value="' + project.id + '"' + (project.id === selected ? ' selected' : '') + '>' + escapeHtml(project.name) + '</option>';
    }).join('');
  }

  function priorityOptions(selected) {
    return ['p1', 'p2', 'p3', 'p4'].map(function (value) {
      return '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + value.toUpperCase() + '</option>';
    }).join('');
  }

  function energyOptions(selected) {
    return ['low', 'medium', 'high'].map(function (value) {
      return '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + value + '</option>';
    }).join('');
  }

  function statusOptions(selected) {
    return ['Inbox', 'Ready', 'Waiting', 'Deferred', 'Done'].map(function (value) {
      return '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + value + '</option>';
    }).join('');
  }

  function bindDragAndDrop() {
    document.querySelectorAll('.task-card[draggable="true"]').forEach(function (card) {
      card.addEventListener('dragstart', function (event) {
        event.dataTransfer.setData('text/plain', card.dataset.taskId);
      });
    });
    document.querySelectorAll('.day-column').forEach(function (column) {
      column.addEventListener('dragover', function (event) {
        event.preventDefault();
        column.classList.add('drag-over');
      });
      column.addEventListener('dragleave', function () {
        column.classList.remove('drag-over');
      });
      column.addEventListener('drop', function (event) {
        event.preventDefault();
        column.classList.remove('drag-over');
        var task = getTask(event.dataTransfer.getData('text/plain'));
        if (task) {
          scheduleTask(task.id, column.dataset.day);
        }
      });
    });
  }

  function maintainFocusTimer() {
    if (nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
    if (state.focusRunning && state.focusTaskId) {
      nowTimer = setInterval(function () {
        state.focusSeconds += 1;
        persist();
        var timer = document.querySelector('.focus-timer');
        if (timer) timer.textContent = formatTimer(state.focusSeconds);
      }, 1000);
    }
  }

  function formatTimer(seconds) {
    var total = Number(seconds) || 0;
    var minutes = Math.floor(total / 60);
    var rest = total % 60;
    return String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
  }

  function parseTaskInput(raw) {
    var text = raw.trim();
    var task = normalizeTask({ title: text, status: 'Inbox' });
    var match;
    match = text.match(/\bp([1-4])\b/i);
    if (match) {
      task.priority = 'p' + match[1];
      text = text.replace(match[0], '');
    }
    match = text.match(/\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i);
    if (match) {
      task.estimate = Math.round(Number(match[1]) * (/^h/.test(match[2].toLowerCase()) ? 60 : 1));
      text = text.replace(match[0], '');
    }
    if (/\btomorrow\b/i.test(text)) {
      task.due = addDaysISO(1);
      text = text.replace(/\btomorrow\b/i, '');
    } else if (/\btoday\b/i.test(text)) {
      task.due = todayISO();
      task.day = todayISO();
      text = text.replace(/\btoday\b/i, '');
    } else if (/\bnext week\b/i.test(text)) {
      task.due = addDaysISO(7);
      text = text.replace(/\bnext week\b/i, '');
    }
    match = text.match(/\b(low|medium|high)\s+energy\b/i);
    if (match) {
      task.energy = match[1].toLowerCase();
      text = text.replace(match[0], '');
    }
    var labels = [];
    text = text.replace(/#([\w-]+)/g, function (_, label) {
      labels.push(label);
      return '';
    });
    task.labels = labels;
    text = text.replace(/@("[^"]+"|[\w -]+)/g, function (_, projectName) {
      var clean = projectName.replace(/"/g, '').trim().toLowerCase();
      var project = state.projects.find(function (item) { return item.name.toLowerCase() === clean; });
      if (project) task.projectId = project.id;
      return '';
    });
    task.title = text.replace(/\s+/g, ' ').trim() || raw.trim();
    if (task.due && task.due <= todayISO()) task.status = 'Ready';
    return task;
  }

  function addTask(task) {
    task.id = task.id || uid('task');
    task.createdAt = Date.now();
    task.updatedAt = Date.now();
    state.tasks.unshift(normalizeTask(task));
    state.selectedTaskId = task.id;
    persist();
    render();
  }

  function updateTask(id, patch) {
    var task = getTask(id);
    if (!task) return;
    Object.assign(task, patch, { updatedAt: Date.now() });
    persist();
    render();
  }

  function scheduleTask(id, day) {
    var task = getTask(id);
    if (!task) return;
    if (task.priority === 'p1' && state.prefs.confirmImportantMoves && task.day && task.day !== day) {
      var ok = window.confirm('This is important work. Confirm moving it to ' + day + '?');
      if (!ok) return;
    }
    updateTask(id, { day: day, status: task.status === 'Inbox' ? 'Ready' : task.status });
  }

  function activeTasks() {
    return state.tasks.filter(function (task) { return task.status !== 'Done'; });
  }

  function filteredTasks() {
    var query = state.query.trim().toLowerCase();
    if (!query) return state.tasks;
    return state.tasks.filter(function (task) {
      var project = getProject(task.projectId);
      return [
        task.title,
        task.status,
        task.priority,
        task.energy,
        task.area,
        task.notes,
        task.labels.join(' '),
        project && project.name
      ].join(' ').toLowerCase().includes(query);
    });
  }

  function todayTasks() {
    var today = todayISO();
    return filteredTasks()
      .filter(function (task) { return task.status !== 'Done' && (task.day === today || (task.due === today && task.status !== 'Deferred')); })
      .sort(taskSort);
  }

  function dueToday() {
    var today = todayISO();
    return activeTasks().filter(function (task) { return task.due === today; });
  }

  function taskSort(a, b) {
    var priority = { p1: 1, p2: 2, p3: 3, p4: 4 };
    if ((a.time || '') !== (b.time || '')) return (a.time || '99:99').localeCompare(b.time || '99:99');
    if (priority[a.priority] !== priority[b.priority]) return priority[a.priority] - priority[b.priority];
    return (b.estimate || 0) - (a.estimate || 0);
  }

  function capacitySummary(day) {
    var fixed = state.calendarBlocks.filter(function (block) { return block.day === day; }).reduce(function (sum, block) {
      return sum + blockMinutes(block.start, block.end);
    }, 0);
    var available = Math.max(60, state.prefs.dailyCapacity - fixed);
    var used = activeTasks().filter(function (task) { return task.day === day; }).reduce(function (sum, task) {
      return sum + (Number(task.estimate) || 0);
    }, 0);
    var percent = Math.round((used / available) * 100);
    return {
      used: used,
      available: available,
      percent: percent,
      usedLabel: minutesLabel(used),
      availableLabel: minutesLabel(available),
      message: percent > 100 ? 'Overloaded. Drop, defer, delegate, or schedule less.' : percent > 85 ? 'Tight but possible. Keep a recovery buffer.' : 'Realistic capacity with room for change.'
    };
  }

  function blockMinutes(start, end) {
    var a = start.split(':').map(Number);
    var b = end.split(':').map(Number);
    return (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
  }

  function planQuality() {
    var items = [];
    var days = Array.from({ length: 7 }, function (_, index) { return addDaysISO(index); });
    days.forEach(function (day) {
      var cap = capacitySummary(day);
      if (cap.percent > 100) {
        items.push({ level: 'danger', title: formatDay(day) + ' is overloaded', detail: cap.usedLabel + ' planned for ' + cap.availableLabel + '. Defer lower priority work.' });
      }
    });
    var unscheduledHigh = activeTasks().filter(function (task) { return task.priority === 'p1' && !task.day && task.status !== 'Waiting'; });
    if (unscheduledHigh.length) {
      items.push({ level: 'warn', title: 'High-priority work has no time', detail: unscheduledHigh.length + ' P1 task needs a slot or an explicit defer decision.' });
    }
    var missed = activeTasks().filter(function (task) { return task.due && task.due < todayISO() && task.status !== 'Waiting'; });
    if (missed.length) {
      items.push({ level: 'danger', title: 'Missed work needs a new slot', detail: missed.length + ' overdue task should be kept, moved, dropped, or delegated.' });
    }
    state.projects.forEach(function (project) {
      var projectTasks = activeTasks().filter(function (task) { return task.projectId === project.id; });
      var hasNext = projectTasks.some(function (task) { return task.status === 'Ready' && !task.blockedBy; });
      if (projectTasks.length && !hasNext) {
        items.push({ level: 'warn', title: project.name + ' has no next action', detail: 'Add a concrete ready task or mark the project waiting.' });
      }
      if (project.lastReviewed && project.lastReviewed < addDaysISO(-7)) {
        items.push({ level: 'warn', title: project.name + ' is stale', detail: 'Review scope, blockers, and next action.' });
      }
    });
    var blocked = activeTasks().filter(function (task) { return task.blockedBy || task.status === 'Waiting'; });
    if (blocked.length) {
      items.push({ level: 'warn', title: 'Blocked work is visible', detail: blocked.length + ' task needs a waiting-for owner or follow-up date.' });
    }
    var score = Math.max(35, 100 - items.reduce(function (sum, item) { return sum + (item.level === 'danger' ? 18 : 10); }, 0));
    return { score: score, items: items.slice(0, 6) };
  }

  function nextBestTask() {
    var energy = state.prefs.energyNow;
    var candidates = todayTasks().filter(function (task) {
      return task.status !== 'Waiting' && !task.blockedBy && task.status !== 'Deferred';
    });
    candidates.sort(function (a, b) {
      var scoreA = taskScore(a, energy);
      var scoreB = taskScore(b, energy);
      return scoreB - scoreA;
    });
    return candidates[0] || activeTasks().filter(function (task) { return !task.blockedBy && task.status === 'Ready'; }).sort(taskSort)[0] || null;
  }

  function taskScore(task, energy) {
    var priorityScore = { p1: 80, p2: 55, p3: 30, p4: 10 }[task.priority] || 10;
    var dueScore = task.due && task.due <= todayISO() ? 25 : 0;
    var energyScore = task.energy === energy ? 18 : task.energy === 'low' ? 8 : 0;
    var scheduleScore = task.day === todayISO() ? 20 : 0;
    return priorityScore + dueScore + energyScore + scheduleScore - Math.min(Number(task.estimate) || 0, 120) / 10;
  }

  function getCounts() {
    return {
      today: todayTasks().length,
      inbox: state.tasks.filter(function (task) { return task.status === 'Inbox'; }).length,
      planned: activeTasks().filter(function (task) { return task.day; }).length
    };
  }

  function projectTaskCount(projectId) {
    return activeTasks().filter(function (task) { return task.projectId === projectId; }).length;
  }

  function getProject(id) {
    return state.projects.find(function (project) { return project.id === id; });
  }

  function getTask(id) {
    return state.tasks.find(function (task) { return task.id === id; });
  }

  function getSelectedTask() {
    return getTask(state.selectedTaskId) || state.tasks[0] || null;
  }

  function pullDue() {
    var today = todayISO();
    activeTasks().forEach(function (task) {
      if (task.due && task.due <= today && task.status !== 'Waiting') {
        task.day = today;
        if (task.status === 'Inbox') task.status = 'Ready';
      }
    });
    persist();
    render();
  }

  function makeRealistic() {
    var today = todayISO();
    var cap = capacitySummary(today);
    if (cap.percent <= 100) return;
    var planned = activeTasks().filter(function (task) { return task.day === today; }).sort(function (a, b) {
      var priority = { p1: 1, p2: 2, p3: 3, p4: 4 };
      return priority[b.priority] - priority[a.priority] || (b.estimate || 0) - (a.estimate || 0);
    });
    var used = cap.used;
    planned.forEach(function (task) {
      if (used <= cap.available || task.priority === 'p1') return;
      task.day = addDaysISO(1);
      task.status = 'Deferred';
      used -= Number(task.estimate) || 0;
    });
    persist();
    render();
  }

  function rescheduleMissed() {
    var today = todayISO();
    activeTasks().forEach(function (task) {
      if (!task.due || task.due >= today || task.status === 'Waiting') return;
      if (task.priority === 'p1') {
        var ok = window.confirm('Suggest moving important missed task "' + task.title + '" into today?');
        if (ok) {
          task.day = today;
          task.status = 'Ready';
          task.updatedAt = Date.now();
        }
        return;
      }
      task.day = addDaysISO(1);
      task.status = 'Deferred';
      task.updatedAt = Date.now();
    });
    persist();
    render();
  }

  function startNext() {
    var task = nextBestTask();
    if (!task) {
      addTask({ title: 'Choose one concrete next action', due: todayISO(), day: todayISO(), estimate: 20, priority: 'p2', energy: 'medium', status: 'Ready' });
      task = state.tasks[0];
    }
    state.focusTaskId = task.id;
    state.focusRunning = false;
    state.focusSeconds = 0;
    state.selectedTaskId = task.id;
    persist();
    render();
  }

  document.addEventListener('submit', function (event) {
    var capture = event.target.closest('[data-capture-form]');
    var quick = event.target.closest('[data-quick-task]');
    var inspector = event.target.closest('[data-inspector-form]');
    var review = event.target.closest('[data-review-form]');
    if (capture) {
      event.preventDefault();
      var raw = capture.capture.value;
      if (raw.trim()) addTask(parseTaskInput(raw));
      capture.reset();
    }
    if (quick) {
      event.preventDefault();
      var data = new FormData(quick);
      addTask({
        title: data.get('title'),
        projectId: data.get('projectId'),
        area: data.get('area'),
        due: data.get('due'),
        estimate: parseEstimate(data.get('estimate')) || 30,
        priority: data.get('priority'),
        energy: data.get('energy'),
        status: data.get('status')
      });
      quick.reset();
    }
    if (inspector) {
      event.preventDefault();
      var form = new FormData(inspector);
      updateTask(inspector.dataset.id, {
        title: form.get('title'),
        projectId: form.get('projectId'),
        area: form.get('area'),
        status: form.get('status'),
        due: form.get('due'),
        day: form.get('day'),
        time: form.get('time'),
        estimate: Number(form.get('estimate')) || 0,
        priority: form.get('priority'),
        energy: form.get('energy'),
        blockedBy: form.get('blockedBy'),
        labels: String(form.get('labels') || '').split(',').map(function (label) { return label.trim(); }).filter(Boolean),
        notes: form.get('notes'),
        checklist: String(form.get('checklist') || '').split('\n').map(function (item) { return item.trim(); }).filter(Boolean)
      });
    }
    if (review) {
      event.preventDefault();
      var reviewData = new FormData(review);
      state.reviews.push({
        id: uid('review'),
        day: todayISO(),
        done: reviewData.get('done'),
        moved: reviewData.get('moved'),
        dropped: reviewData.get('dropped'),
        learned: reviewData.get('learned'),
        createdAt: Date.now()
      });
      persist();
      render();
    }
  });

  document.addEventListener('input', function (event) {
    if (event.target.matches('[data-search]')) {
      state.query = event.target.value;
      persist();
      render();
      var input = document.querySelector('[data-search]');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  });

  document.addEventListener('click', function (event) {
    var viewButton = event.target.closest('[data-view]');
    var action = event.target.closest('[data-action]');
    var taskCard = event.target.closest('.task-card');
    var projectButton = event.target.closest('[data-project]');
    if (viewButton) {
      state.view = viewButton.dataset.view;
      persist();
      render();
      return;
    }
    if (projectButton && !action) {
      state.query = getProject(projectButton.dataset.project).name;
      state.view = 'plan';
      persist();
      render();
      return;
    }
    if (action) {
      handleAction(action.dataset.action, action.dataset);
      return;
    }
    if (taskCard) {
      state.selectedTaskId = taskCard.dataset.taskId;
      persist();
      render();
      var inspector = document.querySelector('[data-inspector]');
      if (inspector) inspector.classList.add('mobile-open');
    }
  });

  function handleAction(action, data) {
    var task = data.id ? getTask(data.id) : null;
    if (action === 'pull-due') pullDue();
    if (action === 'reschedule-missed') rescheduleMissed();
    if (action === 'make-realistic') makeRealistic();
    if (action === 'start-next') startNext();
    if (action === 'create-empty') addTask({ title: 'New task', status: 'Inbox', estimate: 30, priority: 'p3', energy: 'medium' });
    if (action === 'toggle-done' && task) updateTask(task.id, { status: task.status === 'Done' ? 'Ready' : 'Done' });
    if (action === 'schedule-today' && task) scheduleTask(task.id, todayISO());
    if (action === 'defer-task' && task) updateTask(task.id, { status: 'Deferred', day: addDaysISO(1) });
    if (action === 'focus-task' && task) {
      state.focusTaskId = task.id;
      state.focusRunning = false;
      state.focusSeconds = 0;
      state.selectedTaskId = task.id;
      persist();
      render();
    }
    if (action === 'delete-task' && task) {
      state.tasks = state.tasks.filter(function (item) { return item.id !== task.id; });
      state.selectedTaskId = state.tasks[0] && state.tasks[0].id;
      persist();
      render();
    }
    if (action === 'close-focus') {
      state.focusTaskId = null;
      state.focusRunning = false;
      persist();
      render();
    }
    if (action === 'toggle-focus') {
      state.focusRunning = !state.focusRunning;
      persist();
      render();
    }
    if (action === 'complete-focus' && state.focusTaskId) {
      var completed = getTask(state.focusTaskId);
      if (completed) {
        Object.assign(completed, { status: 'Done', updatedAt: Date.now() });
      }
      state.focusTaskId = null;
      state.focusRunning = false;
      persist();
      render();
    }
    if (action === 'defer-focus' && state.focusTaskId) {
      var deferred = getTask(state.focusTaskId);
      if (deferred) {
        Object.assign(deferred, { status: 'Deferred', day: addDaysISO(1), updatedAt: Date.now() });
      }
      state.focusTaskId = null;
      state.focusRunning = false;
      persist();
      render();
    }
    if (action === 'project-next') {
      addTask({ title: 'Define next action for project', projectId: data.project, status: 'Ready', priority: 'p2', energy: 'medium', estimate: 25 });
    }
    if (action === 'add-routine') {
      var routine = state.routines.find(function (item) { return item.id === data.id; });
      if (routine) {
        addTask({ title: routine.title, day: todayISO(), due: todayISO(), estimate: routine.estimate, priority: 'p4', energy: 'low', status: 'Ready', labels: ['routine'] });
      }
    }
    if (action === 'close-inspector') {
      var inspector = document.querySelector('[data-inspector]');
      if (inspector) inspector.classList.remove('mobile-open');
    }
  }

  function parseEstimate(value) {
    var text = String(value || '').trim();
    if (!text) return 0;
    var match = text.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins)?$/i);
    if (!match) return Number(text) || 0;
    return Math.round(Number(match[1]) * (match[2] && /^h/.test(match[2].toLowerCase()) ? 60 : 1));
  }

  render();
}());

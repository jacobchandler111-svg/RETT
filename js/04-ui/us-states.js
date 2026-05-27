// FILE: js/04-ui/us-states.js
// Populates #state-code (Tab 0 Pre-Meeting Filing Information) with the
// 50 US states + DC. Pulled out of index.html on 2026-05-27 to keep the
// HTML edit surface small after Filing Information moved from Tab 1 to
// Tab 0. NY is the default to match the prior <option selected>.

(function () {
  'use strict';
  var STATES = [
    ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],
    ['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],
    ['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],
    ['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
    ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],
    ['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],
    ['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],
    ['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],
    ['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
    ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],
    ['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],
    ['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],
    ['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']
  ];
  var DEFAULT = 'NY';
  function _populate() {
    var sel = document.getElementById('state-code');
    if (!sel || sel.options.length > 0) return;
    for (var i = 0; i < STATES.length; i++) {
      var o = document.createElement('option');
      o.value = STATES[i][0];
      o.textContent = STATES[i][1];
      if (STATES[i][0] === DEFAULT) o.selected = true;
      sel.appendChild(o);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _populate);
  } else {
    _populate();
  }
})();

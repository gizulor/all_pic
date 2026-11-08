/* all_pic — find, add and arrange images in the Write tab

To do:
What if thumbFields aren't numeric:
/images/my_pic.jpg
https://example.com/path/to/images/my_pic.jpg

07/11/2026 refactor:
- every handler is bound once (delegated, .allpic namespace), so async saves no longer stack handlers
- thumbs are cached in a JS Map (id -> markup) and only missing ids are fetched, so a thumb can't be cached twice
- one parser / writer for field values (tolerates spaces, triggers 'change')
- sortable: links/icons cancel a drag, 5px drag threshold, lists initialised once
*/

(function($) {
  'use strict';

  const prefs = window.allPicConfig || {};

  const thumbFields = (prefs.thumbFields || '').split(/[ ,]+/).filter(Boolean);
  const fieldSelector = thumbFields.join(',');
  const shortcodeBase = prefs.shortcodeBase || '<txp::gallery ';
  const shortcodeSingle = prefs.shortcodeSingle || ''; // optional: a different shortcode for one image
  const addImages = prefs.addImages || 'Add Images';
  const deleteText = prefs.deleteText || 'Exclude image';
  const editText = prefs.editText || 'Edit image';
  const closeText = prefs.closeText || 'Close SideView';
  const dropText = prefs.dropText || 'Drag images here';
  const noteText = prefs.noteText || 'or drop them onto Body or Excerpt to insert a shortcode at that spot.';


  /* ---------------------------------------------------------------
   * ids: one way to read a field, one way to write it
   * ------------------------------------------------------------- */

  function parseIds(str) {
    return String(str || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  }

  // change is deferred so other listeners (e.g. the theme's form 'change' hook)
  // never run in the middle of a jQuery UI sortable callback
  function writeIds($input, ids) {
    $input.val(ids.join(','));
    setTimeout(() => $input.trigger('change'), 0);
  }

  const isNumericId = id => /^\d+$/.test(id);

  // shortcode opener as set in prefs, always followed by a space
  const tagBase = b => (b && !/\s$/.test(b) ? b + ' ' : (b || ''));
  const tagBases = [...new Set([shortcodeBase, shortcodeSingle].filter(Boolean).map(tagBase))];

  // the tag for a set of image ids: single-image shortcode for one (if set), gallery shortcode otherwise
  function buildTag(ids) {
    const base = tagBase(ids.length === 1 && shortcodeSingle ? shortcodeSingle : shortcodeBase);
    return `${base}id="${ids.join(',')}" />`;
  }
  const isImageUrl = id => /\.(jpe?g|png|gif|webp|svg)$/i.test(id);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // field <input>  <->  its thumbnail <ul>
  function ulFor($input) {
    return $input.next('.all_pics_container').find('.all_pics');
  }

  function inputFor($ul) {
    return $ul.closest('.all_pics_container').prev(fieldSelector || 'input');
  }


  /* ---------------------------------------------------------------
   * thumb cache (replaces the hidden #all_pic_store)
   * ------------------------------------------------------------- */

  const thumbCache = new Map(); // id -> <li> markup
  const inflight = new Map(); // id -> Promise
  const notFound = new Set(); // ids the server returned nothing for

  function cacheHtml(html) {
    $('<ul>').html(html || '').children('.all_pics__item').each(function() {
      const id = String(this.getAttribute('data-id'));
      if (!thumbCache.has(id)) thumbCache.set(id, this.outerHTML);
    });
  }

  function getThumb(id) {
    id = String(id);
    return thumbCache.has(id) ? $(thumbCache.get(id)) : null;
  }

  // fetch only the numeric ids we don't already have (or aren't already fetching)
  function ensureThumbs(ids) {
    const wanted = ids.filter(isNumericId);
    const missing = wanted.filter(id => !thumbCache.has(id) && !inflight.has(id) && !notFound.has(id));

    if (missing.length) {
      const request = new Promise(resolve => {
        const xhr = sendAsyncEvent({ event: 'all_pic', step: 'get_thumbs', ids: missing.join(',') }, function(html) {
          cacheHtml(html);
        }, 'html');

        const done = () => {
          missing.forEach(id => {
            inflight.delete(id);
            if (!thumbCache.has(id)) notFound.add(id);
          });
          resolve();
        };

        if (xhr && xhr.always) xhr.always(done); else done();
      });

      missing.forEach(id => inflight.set(id, request));
    }

    return Promise.all(wanted.map(id => inflight.get(id)).filter(Boolean));
  }

  function urlThumb(url) {
    return $(`
      <li class="all_pics__item all_pics__item--url" data-id="${esc(url)}">
        <img title="External image" src="${esc(url)}" alt=""/>
        <p>
          <span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="${deleteText}">${deleteText}</a></span>
        </p>
      </li>`);
  }

  // an id with no image behind it: shown so it isn't silently dropped by a reorder or Confirm
  function missingThumb(id) {
    return $(`
      <li class="all_pics__item all_pics__item--missing" data-id="${esc(id)}" title="No image with id ${esc(id)}">
        <span class="all_pics__missing">${esc(id)}?</span>
        <p>
          <span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="${deleteText}">${deleteText}</a></span>
        </p>
      </li>`);
  }

  // Returns a jQuery <li> for an id+src, preferring cached markup
  function makeThumb(id, src) {
    id = String(id).trim();

    const $cached = getThumb(id);
    if ($cached) return $cached;

    const $li = $(`
      <li class="all_pics__item" data-id="${esc(id)}">
        <img title="Drag (${esc(id)}) to relocate" src="${esc(src || '')}" alt=""/>
        <p>
          <span class="all_pics__icon"><a class="ui-icon ui-icon-pencil all_pics__edit" href="#" title="${editText}">${editText}</a></span>
          <span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="${deleteText}">${deleteText}</a></span>
        </p>
      </li>`);

    if (isNumericId(id)) thumbCache.set(id, $li[0].outerHTML);
    return $li;
  }

  // re-fetch one image's thumb (e.g. after it was edited in SideView) and swap it in
  // everywhere it shows: fields and the gallery preview
  function refreshThumb(id) {
    id = String(id || '');
    if (!isNumericId(id)) return;

    thumbCache.delete(id);
    notFound.delete(id);

    ensureThumbs([id]).then(() => {
      $(`.all_pics__item[data-id="${id}"]`).each(function() {
        $(this).replaceWith(getThumb(id) || missingThumb(id)); // missing if it was deleted
      });
    });
  }


  /* ---------------------------------------------------------------
   * rendering
   * ------------------------------------------------------------- */

  function renderList($ul, ids) {
    $ul.empty();
    ids.forEach(id => {
      if (isNumericId(id)) {
        const $thumb = getThumb(id);
        if ($thumb) $ul.append($thumb);
        else if (notFound.has(id)) $ul.append(missingThumb(id));
      } else if (isImageUrl(id)) {
        $ul.append(urlThumb(id));
      }
    });
  }

  function refreshThumbsFromInput($input, $ul) {
    if (!$input.length || !$ul.length) return;

    const ids = parseIds($input.val());
    renderList($ul, ids);

    // anything not cached yet: fetch, then render again from the (current) field value
    if (ids.some(id => isNumericId(id) && !thumbCache.has(id) && !notFound.has(id))) {
      ensureThumbs(ids).then(() => renderList($ul, parseIds($input.val())));
    }
  }

  // write a list's current order back to wherever it belongs
  function resyncFromUl($ul) {
    const order = $ul.children('.all_pics__item')
      .map(function() { return $(this).attr('data-id'); })
      .get();

    // standard field
    const $input = inputFor($ul);
    if ($input.length) {
      writeIds($input, order);
      return;
    }

    // gallery preview dialog: nothing to write until Confirm
  }

  // add containers after each image field (idempotent), redraw thumbs, make lists sortable
  function all_picjs() {
    thumbFields.forEach(function(selector) {
      const $input = $(selector);
      if (!$input.length || $input.next('.all_pics_container').length) return;

      $input.after(
        `<div class="all_pics_container">
          <ul class="all_pics" data-empty="${dropText}"></ul>
        </div>`
      );
    });

    // a single "Add images" link, just before the first configured field that exists
    if (!$('#all_pics__add-main').length) {
      const $first = $(fieldSelector).first();
      if ($first.length) {
        const $field = $first.closest('.txp-form-field');
        ($field.length ? $field : $first).before(
          `<a id="all_pics__add-main" class="all_pics__add all_pics__add--main" href="#" title="${addImages}">${addImages} <span class="ui-icon ui-icon-search"></span></a>`
        );
      }
    }

    $(fieldSelector).each(function() {
      const $input = $(this);
      refreshThumbsFromInput($input, ulFor($input));
    });

    initJQUSortable();
  }


  /* ---------------------------------------------------------------
   * sortable
   * ------------------------------------------------------------- */

  function initJQUSortable() {
    // only lists that aren't sortable yet; connectWith is resolved at drag start,
    // so lists added later are picked up without rebuilding the others
    $('.all_pics').not('.ui-sortable').each(function() {
      const inDialog = $(this).closest('.ui-dialog').length > 0;

      $(this).sortable({
        // fields, shortcode list and the preview dialog all share thumbs
        connectWith: '.all_pics',
        items: '> .all_pics__item',
        // drag a clone attached to <body>: an 'original' helper stays inside the dialog's
        // scrolling content box, which then scrolls instead of letting the thumb leave
        helper: 'clone',
        appendTo: document.body,
        zIndex: 100000,
        scroll: !inDialog,
        cancel: '.all_pics__icon, a, input, textarea, button, select, option',
        distance: 5,
        placeholder: 'all_pics__placeholder',
        forcePlaceholderSize: true,
        tolerance: 'pointer',
        start: function() { $('body').addClass('allpic-dragging'); },
        stop: function() { $('body').removeClass('allpic-dragging'); },
        // fires on both lists when a thumb moves between them
        update: function() { resyncFromUl($(this)); }
      });
    });
  }


  /* ---------------------------------------------------------------
   * shortcode preview in the body textarea
   * ------------------------------------------------------------- */

  function findGalleryAtCaret(text, caret) {
    let open = -1;
    tagBases.forEach(base => { open = Math.max(open, text.lastIndexOf(base, caret)); });
    if (open === -1) return null;

    const close = text.indexOf('/>', open);
    if (close === -1) return null;

    // caret must be within the tag bounds
    if (caret < open || caret > close + 2) return null;

    return { start: open, end: close + 2, tag: text.slice(open, close + 2) };
  }

  function getCaretCoordsInTextarea(textarea, pos) {
    const cs = window.getComputedStyle(textarea);
    const div = document.createElement('div');

    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.overflow = 'hidden';

    [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'lineHeight', 'textAlign', 'width'
    ].forEach(p => div.style[p] = cs[p]);

    div.style.height = cs.height;
    div.textContent = textarea.value.substring(0, pos);

    const span = document.createElement('span');
    span.textContent = textarea.value.substring(pos) || '.';
    div.appendChild(span);

    document.body.appendChild(div);
    const spanRect = span.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    document.body.removeChild(div);

    return {
      top: (spanRect.top - divRect.top) - textarea.scrollTop,
      left: (spanRect.left - divRect.left) - textarea.scrollLeft
    };
  }

  const ID_ATTR = /(^|\s)id\s*=\s*(['"])(.*?)\2/i;

  function extractIdsFromGalleryTag(tag) {
    const m = tag.match(ID_ATTR);
    return m ? parseIds(m[3]) : [];
  }

  // set id="…" in a tag, keeping any other attributes
  function setIdsInTag(tag, ids) {
    const attr = `id="${ids.join(',')}"`;
    if (ID_ATTR.test(tag)) return tag.replace(ID_ATTR, `$1${attr}`);
    return tag.replace(/\s*\/>$/, ` ${attr} />`);
  }

  function ensurePreviewUI($ta) {
    if (!$ta.parent('.allpic-ta-wrap').length) {
      $ta.wrap('<div class="allpic-ta-wrap" style="position:relative;"></div>');
    }

    const $wrap = $ta.parent('.allpic-ta-wrap');

    if (!$wrap.find('.allpic-preview-btn').length) {
      $wrap.append(`
        <button type="button" class="allpic-preview-btn" style="position:absolute; display:none; z-index:5;">
          <span class="ui-icon ui-icon-notice" title="Preview shortcode"></span>
        </button>
      `);
    }
  }

  function updatePreviewButton($ta) {
    // only one button on the page
    $('.allpic-preview-btn').hide().removeData('galleryRange');

    ensurePreviewUI($ta);

    const ta = $ta[0];
    const caret = ta.selectionStart || 0;
    const hit = findGalleryAtCaret(ta.value, caret);
    const $btn = $ta.parent('.allpic-ta-wrap').find('.allpic-preview-btn');

    if (!hit) return;

    const coords = getCaretCoordsInTextarea(ta, caret);
    $btn.show().css({ top: (coords.top + 6) + 'px' }).data('galleryRange', hit);
  }

  function closeGalleryPreview() {
    const $dlg = $('#allpic-gallery-dialog');
    if ($dlg.length) {
      try { $dlg.dialog('destroy'); } catch (e) {}
      $dlg.remove();
    }
  }

  function openGalleryPreview($ta, range) {
    closeGalleryPreview();

    const ids = extractIdsFromGalleryTag(range.tag);

    const $panel = $(`
      <div id="allpic-gallery-dialog" title="Shortcode preview">
        <div style="display:flex; gap:.5em; align-items:center; margin-bottom:.5em;">
          <a class="all_pics__add" href="#" title="${addImages}">${addImages} <span class="ui-icon ui-icon-search"></span></a>
          <button type="button" class="allpic-confirm-btn">Confirm</button>
          <button type="button" class="allpic-cancel-btn">Close</button>
        </div>
        <ul class="all_pics all_pics--dialog" data-empty="${dropText}"></ul>
      </div>
    `);

    $('body').append($panel);

    const ta = $ta[0];
    const coords = getCaretCoordsInTextarea(ta, ta.selectionStart || 0);
    const taRect = ta.getBoundingClientRect();
    const top = window.scrollY + taRect.top + coords.top + 24;
    const left = window.scrollX + taRect.left + 24;

    $panel.dialog({
      modal: false,
      draggable: true,
      resizable: true,
      width: 520,
      minWidth: 360,
      position: { my: 'left top', at: `left+${Math.round(left)} top+${Math.round(top)}`, of: window },
      close: closeGalleryPreview
    });

    const $ul = $panel.find('.all_pics');

    ensureThumbs(ids).then(() => {
      renderList($ul, ids.filter(isNumericId));
      initJQUSortable();
    });

    $panel.on('click', '.allpic-cancel-btn', closeGalleryPreview);

    $panel.on('click', '.allpic-confirm-btn', function() {
      const order = $ul.children('.all_pics__item')
        .map(function() { return $(this).attr('data-id'); })
        .get();

      // the textarea may have changed while the dialog was open: re-find the tag
      const hit = findGalleryAtCaret(ta.value, range.start + 1) || range;
      const newTag = setIdsInTag(hit.tag, order);

      ta.value = ta.value.slice(0, hit.start) + newTag + ta.value.slice(hit.end);

      const newCaret = hit.start + newTag.length;
      ta.setSelectionRange(newCaret, newCaret);
      $ta.trigger('input').trigger('change');

      closeGalleryPreview();
    });
  }


  /* ---------------------------------------------------------------
   * SideView (Images panel in an iframe)
   * ------------------------------------------------------------- */

  function openSideView() {
    window.scrollTo(0, 0);

    const isAdd = $(this).hasClass('all_pics__add');
    const imageId = isAdd ? '' : $(this).closest('.all_pics__item').attr('data-id');
    const iframeUrl = isAdd ?
      'index.php?event=image' :
      `index.php?event=image&step=image_edit&id=${encodeURIComponent(imageId)}`;

    if ($('#sideView_container').length) {
      $('#sideView').attr('src', iframeUrl);
    } else {
      // remove all_sideview if active
      if ($('#sideview').length) {
        $('#sideview').remove();
        localStorage.setItem('sideView', 'false');
        $('.sideview__button').removeClass('sideview--active');
      }

      $('.txp-body').append(
        `<div id="sideView_container" role="dialog">
          <iframe id="sideView" src="${iframeUrl}" frameborder="0"></iframe>
        </div>`
      );

      // bound once per iframe, not once per click
      $('#sideView').on('load.allpic', onSideViewLoad);
    }

    // control panel: use the current label of each specified field
    if (!$('#sideView_container > header').length) {
      let fields = '';
      for (let i = 1; i < thumbFields.length; i++) {
        const fieldId = thumbFields[i].replace('#', '');
        const label = $(thumbFields[i]).parent().prev().find('label').text();
        fields += `<li data-name="${esc(fieldId)}"><a>${esc(label)}</a></li>`;
      }

      $('#sideView_container').prepend(`
        <header>
          <div class="all_pic__banner">
            <p>Drag a thumb (or a selection of thumbs) directly to your collection,</p>
            <p><a id="all_pic__close" href="#">${closeText}</a></p>
          </div>
          <p>or add selected images to</p>
          <ul>
            <li data-name="article-image"><a>${esc($('#txp-image-group-label').text())}</a></li>
            ${fields}
          </ul>
          <p class="all_pic__note">${esc(noteText)}</p>
        </header>`);
    }

    return false;
  }

  let sideViewEditId = null; // image open for editing in SideView, if any

  function onSideViewLoad() {
    let iframe;
    try {
      iframe = $('#sideView').contents();
    } catch (err) {
      return; // cross-origin or iframe access failure
    }

    // native drag and drop out of the iframe (same-origin, so the parent can see it start)
    const rowId = $tr => $tr.find('.txp-list-col-id a').text().trim();
    const rowSrc = $tr => $tr.find('.has-thumbnail img').prop('src');

    iframe.find('body')
      .off('.allpicdrag')
      .on('dragstart.allpicdrag', '.has-thumbnail img', function(e) {
        const $tr = $(this).closest('tr');
        if (!rowId($tr)) return;

        // dragging a selected row carries every selected row; otherwise just this one
        const $rows = $tr.hasClass('selected') ? $tr.closest('tbody').find('tr.selected') : $tr;
        const items = $rows.map(function() { return { id: rowId($(this)), src: rowSrc($(this)) }; }).get();

        const dt = e.originalEvent.dataTransfer;
        dt.effectAllowed = 'copy';
        try {
          dt.setData('text/x-allpic-ids', items.map(i => i.id).join(','));
          dt.setData('text/plain', buildTag(items.map(i => i.id))); // what Body/Excerpt insert where it's dropped
        } catch (err) {}

        allPicDrag.begin(items);
      })
      .on('dragend.allpicdrag', function() { allPicDrag.end(); })
      // back over the iframe: no placeholder in the form
      .on('dragover.allpicdrag', function() { allPicDrag.leave(); })
      // never let a dropped thumb land in the iframe's own inputs as a URL
      .on('drop.allpicdrag', function(e) { if (allPicDrag.active()) e.preventDefault(); });

    // hide control panel elements if we're editing an image
    if (iframe.find('#image_details_form').length > 0) {
      $('body').addClass('all_pics__edit--is-active');
      iframe.find('.txp-edit-actions').on('click', function() {
        $('body').removeClass('all_pics__edit--is-active');
      });
    } else {
      $('body').removeClass('all_pics__edit--is-active');
    }

    iframe.find('body').addClass('all_pic_modified');

    if (iframe.find('#tom_ig_options').length == 0 || iframe.find('.all_behive-icons').length == 0) {
      iframe.find('body#page-image').addClass('grid-active');
    }


    // column display options: into the right-hand end of the table header (styled in all_pic.scss).
    // TXP builds them after load and rebuilds the list on async sort/search/paging, so keep re-placing them
    const idoc = iframe[0];
    const iwin = idoc.defaultView;

    const placeListOptions = () => {
      const opts = idoc.querySelector('.txp-list-options');
      const row = idoc.querySelector('#images_form thead tr');
      if (!opts || !row) return;

      const btn = opts.querySelector('.txp-list-options-button');
      if (btn && btn.type !== 'button') btn.type = 'button'; // inside the form: must not submit it

      if (opts.closest('thead')) return;

      let th = row.querySelector('th.all_pic__list-options');
      if (!th) {
        th = idoc.createElement('th');
        th.className = 'all_pic__list-options';
        row.appendChild(th);
      }
      th.appendChild(opts);
    };

    // per-row tweaks; TXP swaps in new rows without a reload on sort, search and paging
    const prepRows = () => {
      idoc.querySelectorAll('.has-thumbnail img:not([draggable])').forEach(img => img.setAttribute('draggable', 'true'));
      idoc.querySelectorAll('.has-thumbnail a[href]:not([href=""])').forEach(a => a.setAttribute('href', ''));
    };

    prepRows();
    placeListOptions();

    let queued = false;
    new iwin.MutationObserver(function() {
      if (queued) return;
      queued = true;
      iwin.requestAnimationFrame(function() { queued = false; prepRows(); placeListOptions(); });
    }).observe(idoc.body, { childList: true, subtree: true });

    // an image edited in SideView: refresh its thumb in the form once it's saved.
    // Save, thumbnail create/upload/delete and Delete reload the iframe (handled on the next load);
    // Replace image uploads asynchronously (uploadEnd), as can other async saves (txpAsyncForm.success)
    if (sideViewEditId) refreshThumb(sideViewEditId);

    const $editForm = iframe.find('#image_details_form');
    sideViewEditId = $editForm.length ? ($editForm.find('input[name="id"]').val() || new URL(iwin.location.href).searchParams.get('id')) : null;

    if (sideViewEditId && iwin.textpattern && iwin.textpattern.Relay) {
      const id = sideViewEditId;
      const later = () => setTimeout(() => refreshThumb(id), 300);
      iwin.textpattern.Relay.register('uploadEnd', later);
      iwin.textpattern.Relay.register('txpAsyncForm.success', later);
    }
  }

  // "add selected images to …" — reads the iframe's selection at click time
  function addSelectedTo() {
    const fieldName = $(this).closest('[data-name]').attr('data-name');
    const $targetInput = $('#' + fieldName);
    const $ul = ulFor($targetInput);

    let iframe;
    try { iframe = $('#sideView').contents(); } catch (e) { return false; }

    const ids = parseIds($targetInput.val());

    iframe.find('tr.selected').each(function() {
      const sourceId = $(this).find('.txp-list-col-id a').text().trim();
      const sourceUrl = $(this).find('.has-thumbnail img').prop('src');
      if (sourceId && !ids.includes(sourceId)) {
        ids.push(sourceId);
        $ul.append(makeThumb(sourceId, sourceUrl));
      }
    });

    writeIds($targetInput, ids);

    // deselect selected checkboxes
    iframe.find('tr.selected').removeClass('selected').find('input').prop('checked', false);
    iframe.find('.txp-list-col-multi-edit input').prop('checked', false);
    return false;
  }

  function deleteThumb() {
    const $item = $(this).closest('.all_pics__item');
    const $ul = $item.closest('.all_pics');
    const id = String($item.attr('data-id'));
    const $input = inputFor($ul);

    $item.remove();

    if ($input.length) {
      // remove just this id from the field (keeps ids that have no thumb)
      const ids = parseIds($input.val());
      const index = ids.indexOf(id);
      if (index !== -1) ids.splice(index, 1);
      writeIds($input, ids);
    } else {
      resyncFromUl($ul);
    }

    return false;
  }


  /* ---------------------------------------------------------------
   * drag from the SideView iframe into a list
   * ------------------------------------------------------------- */

  const allPicDrag = (function() {
    let dragging = null; // { items: [{ id, src }] }
    let $ph = null; // placeholder <li>
    let $activeUL = null; // currently hovered UL

    function clearPlaceholder() {
      if ($ph) $ph.detach();
      if ($activeUL) {
        $activeUL.removeClass('allpic-dropzone-active');
        $activeUL = null;
      }
    }

    function placePlaceholderAt(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el || !el.closest) { clearPlaceholder(); return; }

      let ul = el.closest('.all_pics');
      if (!ul) {
        const ct = el.closest('.all_pics_container, #allpic-gallery-dialog');
        ul = ct ? ct.querySelector('.all_pics') : null;
      }
      if (!ul) { clearPlaceholder(); return; }

      const $ul = $(ul);

      if (!$activeUL || !$activeUL.is($ul)) {
        if ($activeUL) $activeUL.removeClass('allpic-dropzone-active');
        $activeUL = $ul.addClass('allpic-dropzone-active');
      }

      if (!$ph) $ph = $('<li class="all_pics__placeholder"></li>');

      for (const node of $ul.children('.all_pics__item').get()) {
        const r = node.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) {
          $(node).before($ph);
          return;
        }
      }
      $ul.append($ph);
    }

    // dragstart in the iframe
    function begin(items) {
      const seen = new Set();
      items = (items || [])
        .map(i => ({ id: String(i.id || '').trim(), src: i.src || '' }))
        .filter(i => i.id && !seen.has(i.id) && seen.add(i.id));
      if (!items.length) return;

      end();
      dragging = { items };
      $('.all_pics').addClass('allpic-dropzone');
    }

    // dragover anywhere in this (parent) document
    function over(e) {
      if (!dragging) return;
      placePlaceholderAt(e.clientX, e.clientY);

      if ($ph && $ph.parent().length) {
        e.preventDefault(); // allow a drop here
        e.dataTransfer.dropEffect = 'copy';
      }
    }

    // textareas that accept a dropped shortcode (inserted by the browser at the drop point)
    const TEXT_TARGETS = 'textarea#body, textarea#excerpt';

    // drop anywhere in this document (capture phase)
    function drop(e) {
      if (!dragging) return;

      if (!($ph && $ph.parent().length) && e.target.closest && e.target.closest(TEXT_TARGETS)) {
        end(); // let the browser insert the shortcode
        return;
      }

      e.preventDefault(); // nothing (e.g. an image URL) pasted into other fields
      dropAt();
      end();
    }

    function dropAt() {
      const $ul = ($ph && $ph.parent().length) ? $ph.parent() : null;
      if (!$ul || !dragging) return;

      const isDialog = $ul.closest('#allpic-gallery-dialog').length > 0;
      if (!isDialog && !inputFor($ul).length) return;

      // skip ids already in this list (previously produced duplicates)
      const present = new Set($ul.children('.all_pics__item').map(function() { return String($(this).attr('data-id')); }).get());
      const thumbs = dragging.items.filter(i => !present.has(i.id)).map(i => makeThumb(i.id, i.src)[0]);
      if (!thumbs.length) return;

      $ph.before(thumbs).detach();

      if (!isDialog) resyncFromUl($ul);
    }

    // dragend in the iframe (drop, Escape, or released somewhere else)
    function end() {
      clearPlaceholder();
      if (!dragging) return;
      dragging = null;
      $('.all_pics').removeClass('allpic-dropzone');
    }

    return { begin, over, drop, end, leave: clearPlaceholder, active: () => !!dragging };
  })();


  /* ---------------------------------------------------------------
   * helpers
   * ------------------------------------------------------------- */

  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function isChrome() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('crios') || ua.includes('chrome') || !!window.chrome;
  }


  /* ---------------------------------------------------------------
   * init: everything below runs exactly once per page load
   * ------------------------------------------------------------- */

  $(function() {
    cacheHtml(prefs.thumb_markup);

    all_picjs();

    // wrap the body textarea up front: wrapping it on first focus moved it and dropped the focus
    if ($('#body').length) ensurePreviewUI($('#body'));

    // async save: redraw only — handlers are delegated and survive partial replacement
    textpattern.Relay.register('txpAsyncForm.success', all_picjs);

    // typed/pasted changes to a field
    $(document).on('input.allpic', fieldSelector, debounce(function() {
      const $input = $(this);
      refreshThumbsFromInput($input, ulFor($input));
    }, 400));

    // shortcode preview button in the body textarea
    $(document).on('click.allpic keyup.allpic focusin.allpic', '#body', function() {
      updatePreviewButton($(this));
    });

    $(document).on('click.allpic', '.allpic-preview-btn', function() {
      const range = $(this).data('galleryRange');
      if (range) openGalleryPreview($(this).siblings('textarea'), range);
    });

    // SideView
    $(document).on('click.allpic', '.all_pics__add, .all_pics__edit', openSideView);
    $(document).on('click.allpic', '#all_pic__close', function() {
      $('#sideView_container').remove();
      return false;
    });
    $(document).on('click.allpic', '#sideView_container header li[data-name]', addSelectedTo);

    // exclude a thumb
    $(document).on('click.allpic', '.all_pics__delete', deleteThumb);

    // native drag from SideView: drop targets live in this document
    document.addEventListener('dragover', allPicDrag.over);
    document.addEventListener('drop', allPicDrag.drop, true);

    if (isChrome()) $('body').addClass('is-chrome');
  });

  // exports (kept for anything that referenced them)
  window.allPic = window.allPic || {};
  window.allPic.makeThumb = makeThumb;
  window.allPicDrag = allPicDrag;

})(jQuery);

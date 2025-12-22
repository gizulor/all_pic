/* To do:
What if thumbFields aren't numeric:
/images/my_pic.jpg
https://example.com/path/to/images/my_pic.jpg


*/


$(document).ready(function() {

  const prefs = window.allPicConfig || {};

  const thumbFields = prefs.thumbFields?.split(/[ ,]+/) || [];
  const shortcodeBase = prefs.shortcodeBase || '';
  const addImages = prefs.addImages || 'Add Images';
  const deleteText = prefs.deleteText || 'Exclude image';
  const editText = prefs.editText || 'Edit image';
  const closeText = prefs.closeText || 'Close SideView';

  // create a combined jQuery object from all fields
  const $thumbInputs = $(thumbFields.join(','));

  if (!$('#all_pic_store').length) {
    $('body').append('<div id="all_pic_store">' + (prefs.thumb_markup || '') + '</div>');
  }

  all_picjs();
  textpattern.Relay.register('txpAsyncForm.success', function() {
    all_picjs();
    initJQUSortable(); // ensure sortable is rebound after partial reload
  });

  function all_picjs() {
    // add UI containers after each image field
    thumbFields.forEach(function(selector) {
      const $input = $(selector);
      if ($input.next('.all_pics_container').length) return; // already exists
      //$input.after(`…`);

      $(selector).after(
        `<div class="all_pics_container">
          <ul class="all_pics"></ul>
          <a class="all_pics__add" href="#" title="${addImages}">${addImages} <span class="ui-icon ui-icon-search"></span></a>
        </div>`
      );
    });

    // add thumbs to each container
    $('.all_pics').each(function() {
      const $container = $(this);
      const $input = $container.parent().prev();
      refreshThumbsFromInput($input, $container);
    });




    // show preview of shortcodes in a textarea

    function findGalleryAtCaret(text, caret) {
      const open = text.lastIndexOf(`${shortcodeBase}`, caret);
      if (open === -1) return null;

      const close = text.indexOf('/>', open);
      if (close === -1) return null;

      // caret must be within the tag bounds
      if (caret < open || caret > close + 2) return null;

      const tag = text.slice(open, close + 2);
      return { start: open, end: close + 2, tag };
    }

    function getCaretCoordsInTextarea(textarea, pos) {
      const cs = window.getComputedStyle(textarea);
      const div = document.createElement('div');

      // Mirror textarea styling
      div.style.position = 'absolute';
      div.style.visibility = 'hidden';
      div.style.whiteSpace = 'pre-wrap';
      div.style.wordWrap = 'break-word';
      div.style.overflow = 'hidden';

      // Copy key styles
      const props = [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'lineHeight', 'textAlign', 'width'
      ];
      props.forEach(p => div.style[p] = cs[p]);

      // Match scroll state
      div.style.height = cs.height;

      // Content up to caret + marker
      const text = textarea.value.substring(0, pos);
      div.textContent = text;

      const span = document.createElement('span');
      span.textContent = textarea.value.substring(pos) || '.';
      div.appendChild(span);

      document.body.appendChild(div);

      // Coordinates inside the mirrored box
      const spanRect = span.getBoundingClientRect();
      const divRect = div.getBoundingClientRect();

      // Convert to textarea-local coords (top/left inside content box)
      const top = (spanRect.top - divRect.top) - textarea.scrollTop;
      const left = (spanRect.left - divRect.left) - textarea.scrollLeft;

      document.body.removeChild(div);

      return { top, left };
    }


    function extractIdsFromGalleryTag(tag) {
      const m = tag.match(/\bid\s*=\s*(['"])(.*?)\1/i);
      if (!m) return [];
      return m[2].split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    }

    function ensurePreviewUI($ta) {
      if (!$ta.parent('.allpic-ta-wrap').length) {
        $ta.wrap('<div class="allpic-ta-wrap" style="position:relative;"></div>');
      }

      const $wrap = $ta.parent('.allpic-ta-wrap');

      // ensure a single button exists
      if (!$wrap.find('.allpic-preview-btn').length) {
        $wrap.append(`
          <button type="button" class="allpic-preview-btn" style="position:absolute; display:none; z-index:5;">
            <span class="ui-icon ui-icon-notice" title="Preview shortcode"></span>
          </button>
        `);
      }
    }

    function updatePreviewButton($ta) {
      // enforce only one button on the page (requirement #2)
      $('.allpic-preview-btn').hide().removeData('galleryRange');

      ensurePreviewUI($ta);

      const ta = $ta[0];
      const caret = ta.selectionStart || 0;
      const hit = findGalleryAtCaret(ta.value, caret);

      const $wrap = $ta.parent('.allpic-ta-wrap');
      const $btn = $wrap.find('.allpic-preview-btn');

      if (!hit) {
        $btn.hide().removeData('galleryRange');
        return;
      }

      // position the button at caret Y (x handled by your CSS)
      const coords = getCaretCoordsInTextarea(ta, caret);

      $btn
        .show()
        .css({ top: (coords.top + 6) + 'px' }) // +6 to align nicely; tweak to taste
        .data('galleryRange', hit);
    }

    const $bodyTa = $('#body'); // adjust if needed
    $bodyTa.on('click keyup focus', function() {
      updatePreviewButton($(this));
    });
    $bodyTa.off('.allpic').on('click.allpic keyup.allpic focus.allpic', function() {
      updatePreviewButton($(this));
    });

    function openGalleryPreview($ta, range) {
      closeGalleryPreview();

      const ids = extractIdsFromGalleryTag(range.tag);

      // create dialog content
      const $panel = $(`
        <div id="allpic-gallery-dialog" title="Shortcode preview">
          <div style="display:flex; gap:.5em; align-items:center; margin-bottom:.5em;">
            <a class="all_pics__add" href="#" title="${addImages}">${addImages} <span class="ui-icon ui-icon-search"></span></a>
            <button type="button" class="allpic-confirm-btn">Confirm</button>
            <button type="button" class="allpic-cancel-btn">Close</button>

          </div>
          <ul class="all_pics"></ul>

        </div>
      `);

      $('body').append($panel);

      // position dialog near caret
      const ta = $ta[0];
      const caret = ta.selectionStart || 0;
      const coords = getCaretCoordsInTextarea(ta, caret);
      const taRect = ta.getBoundingClientRect();

      const top = window.scrollY + taRect.top + coords.top + 24;
      const left = window.scrollX + taRect.left + 24;

      // create jQuery UI dialog (draggable/resizable)
      $panel.dialog({
        modal: false,
        draggable: true,
        resizable: true,
        width: 520,
        minWidth: 360,
        position: { my: 'left top', at: `left+${Math.round(left)} top+${Math.round(top)}`, of: window },
        close: function() { closeGalleryPreview(); }
      });

      const $ul = $panel.find('.all_pics');

      // Ensure thumbs exist in store: fetch any missing numeric IDs
      const missing = ids.filter(id => /^\d+$/.test(id) && $('#all_pic_store').find(`[data-id="${id}"]`).length === 0);

      function renderFromIds() {
        $ul.empty();
        ids.forEach(id => {
          if (/^\d+$/.test(id)) {
            const $thumb = $('#all_pic_store').find(`[data-id="${id}"]`).clone();
            if ($thumb.length) $ul.append($thumb);
          }
        });
        //initJQUSortable();
      }

      if (missing.length) {
        sendAsyncEvent({ event: 'all_pic', step: 'get_thumbs', ids: missing.join(',') }, function(html) {
          if (html && html.trim()) $('#all_pic_store').append(html);
          renderFromIds();
        }, 'html');
      } else {
        renderFromIds();
      }

      $panel.on('click', '.allpic-cancel-btn', function() {
        closeGalleryPreview();
      });

      $panel.on('click', '.allpic-confirm-btn', function() {
        const order = $ul.children('.all_pics__item')
          .map(function() { return $(this).attr('data-id'); })
          .get()
          .join(',');

        const base = (window.allPicConfig && window.allPicConfig.shortcodeBase) || '<txp::gallery ';
        const newTag = `${base}id="${order}" />`;

        const before = ta.value.slice(0, range.start);
        const after = ta.value.slice(range.end);
        ta.value = before + newTag + after;

        const newCaret = range.start + newTag.length;
        ta.setSelectionRange(newCaret, newCaret);
        $ta.trigger('input');

        closeGalleryPreview();
      });
    }

    $('body').on('click', '.allpic-preview-btn', function() {
      const $ta = $(this).siblings('textarea');
      const range = $(this).data('galleryRange');
      if (!range) return;
      openGalleryPreview($ta, range);
    });


    function closeGalleryPreview() {
      // jQuery UI dialog, if present
      const $dlg = $('#allpic-gallery-dialog');
      if ($dlg.length) {
        try { $dlg.dialog('destroy'); } catch (e) {}
        $dlg.remove();
      }
    }


    function refreshThumbsFromInput($input, container) {
      const ids = ($input.val() || '').split(/[ ,]+/).map(s => s.trim()).filter(Boolean);

      container.empty();

      ids.forEach(function(item) {
        const id = item.trim();

        // Check if it's a numeric ID (match against #all_pic_store)
        if (/^\d+$/.test(id)) {
          const $thumb = $('#all_pic_store').find(`[data-id="${id}"]`).clone();
          if ($thumb.length) {
            container.append($thumb);
          } else {
            console.warn(`No cached thumb for ID ${id}`);
          }

          // Otherwise, treat it as a URL or relative path and build a generic thumb
        } else if (/\.(jpe?g|png|gif|webp|svg)$/i.test(id)) {
          const thumbHtml = `
            <li class="all_pics__item all_pics__item--url" data-id="${id}">
              <img title="External image" src="${id}" alt=""/>
              <p>
                <span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="${deleteText}">${deleteText}</a></span>
              </p>
            </li>`;
          container.append(thumbHtml);
        }
      });
    }









    // make all lists (including any existing shortcode list) sortable
    initJQUSortable();






    // respond to manual deletions or additions of ids in a field
    $thumbInputs.on('input', debounce(function() {
      const $input = $(this);
      const container = $input.next().find('.all_pics');
      const value = $input.val().split(/[ ,]+/).map(s => s.trim()).filter(Boolean);

      const currentIds = container.find('.all_pics__item').map(function() {
        return $(this).attr('data-id');
      }).get();

      // Remove missing thumbs
      currentIds.forEach(id => {
        if (!value.includes(id)) {
          container.find(`[data-id="${id}"]`).remove();
        }
      });

      // recreate thumbs to suit current ids
      // calls php all_pic_ajax_get_thumbs()
      const newIds = value.filter(id => !currentIds.includes(id));
      if (!newIds.length) return;
      sendAsyncEvent({
        event: 'all_pic',
        step: 'get_thumbs',
        ids: newIds.join(','),
      }, function(response) {
        //console.log('response:', response);

        if (response.trim()) {
          // Add the returned thumbs to the hidden store
          $('#all_pic_store').append(response);

          // Now refresh from input so they appear in correct order
          refreshThumbsFromInput($input, container);
        } else {
          console.warn(`No thumbs returned for IDs: ${newIds.join(', ')}`);
        }
      }, 'html');

    }, 400));

    // SideView actions
    $('body').on('click', '.all_pics__add, .all_pics__edit', function() {
      window.scrollTo(0, 0);
      // assign url to each
      const isAdd = $(this).hasClass('all_pics__add');
      const imageId = isAdd ? '' : $(this).closest('.all_pics__item').attr('data-id');
      const iframeUrl = isAdd ?
        'index.php?event=image' :
        `index.php?event=image&step=image_edit&id=${imageId}`;

      // Create SideView
      if ($('#sideView_container').length) {
        // If already open, update the iframe src
        $('#sideView').attr('src', iframeUrl);
      } else {
        // remove all_sideview if active
        if ($('#sideview').length) {
          $('#sideview').remove();
          localStorage.setItem('sideView', 'false');
          $('.sideview__button').removeClass('sideview--active');

        }
        // Otherwise, create it fresh
        $('.txp-body').append(
          `<div id="sideView_container" role="dialog">
            <iframe id="sideView" src="${iframeUrl}" frameborder="0"></iframe>
          </div>`
        );
      }



      // Add control panel
      // Use the current language title of each specified custom field, and set up identifiers
      let fields = '';
      for (let i = 1; i < thumbFields.length; i++) {
        const fieldId = thumbFields[i].replace('#', '');
        const label = $(thumbFields[i]).parent().prev().find('label').text();
        fields += `<li data-name="${fieldId}"><a>${label}</a></li>`;
      }

      const thumbHeader = `
        <header>
          <div class="all_pic__banner">
            <p>Drag a thumbnail directly to your collection,</p>
            <p><a id="all_pic__close" href="#">${closeText}</a></p>
          </div>
          <p>or add selected images to</p>
          <ul>
            <li data-name="article-image"><a>${$('#txp-image-group-label').text()}</a></li>
            ${fields}
          </ul>
          <div data-name="shortcode">
            or a <a>shortcode</a>.
            <input type="text" hidden id="shortcode"/>
            <textarea id="shortcodeOut"></textarea>
            <ul class="all_pics"></ul>
          </div>
        </header>`;

      // reinstate header if we've been editing an image in SideView
      if ($('#sideView_container > header').length == 0) {
        $('#sideView_container').prepend(thumbHeader);
      }

      // (re)bind sortable now that the shortcode UL exists
      initJQUSortable();

      $('#all_pic__close').on('click', function() {
        $('#sideView_container').remove();
        return false;
      });


      $('#sideView').on('load', function() {
        const iframe = $('#sideView').contents();




        // Make thumbs draggable-from-iframe (same-origin)
        try {
          // bind inside iframe document, but call parent drag module
          iframe.find('body')
            .off('mousedown.allpicdrag')
            .on('mousedown.allpicdrag', '.has-thumbnail img', function(e) {

              const $tr = $(this).closest('tr');
              const id = $tr.find('.txp-list-col-id a').text().trim();
              const src = $(this).prop('src');

              if (!id) return;

              const iframeEl = document.getElementById('sideView');
              const r = iframeEl.getBoundingClientRect();

              // Translate iframe-local mouse coords to parent viewport coords
              const startX = r.left + e.clientX;
              const startY = r.top + e.clientY;

              window.allPicDrag.begin({ id, src, startX, startY });

              e.preventDefault();
              e.stopPropagation();
            });
        } catch (err) {
          // cross-origin or iframe access failure: ignore
        }
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
        iframe.find('.has-thumbnail a').attr('href', '');
        if (iframe.find('#tom_ig_options').length == 0 || iframe.find('.all_behive-icons').length == 0) {
          iframe.find('body#page-image').addClass('grid-active');

          iframe.find('#images_form').before('<div class="all_behive-icons grid-active"><button class="ui-icon ui-icon-large ui-icon-grip-dotted-horizontal" href="">Grid View</button><button class="ui-icon ui-icon-large ui-icon-grip-solid-horizontal" href="">List View</button></div>');

          iframe.find('.all_behive-icons button').on('click', function() {
            iframe.find('body#page-image').toggleClass('grid-active');
            return false;
          });





        }


        iframe.find('#current-page').remove(); // screws things up

        $('#sideView_container header [data-name]').each(function() {
          const fieldName = $(this).attr('data-name');
          const $targetInput = $('#' + fieldName);

          $(this).on('click', function() {
            const targetContainer = $targetInput.parent().find('.all_pics');
            const isShortcode = fieldName === 'shortcode';
            const idsBase = ($targetInput.val() || '').split(',');
            // remove empty values
            const ids = idsBase.filter(function(e) { return e });


            iframe.find('tr.selected').each(function() {
              const sourceId = $(this).find('.txp-list-col-id a').text();
              const sourceUrl = $(this).find('.has-thumbnail img').prop('src');
              if (!ids.includes(sourceId)) {
                ids.push(sourceId);

                temporaryThumb(targetContainer, sourceId, sourceUrl);
              }
            });

            $targetInput.val(ids);

            if (isShortcode) {
              $('#shortcodeOut').show();
              const shortcode = `${shortcodeBase}id="${ids.join(',').replace(/^(,+)/, '')}" />`;
              $('#shortcodeOut').val(shortcode).select();
            }

            // deselect selected checkboxes
            iframe.find('tr.selected').removeClass('selected').find('input').prop('checked', false);
            iframe.find('.txp-list-col-multi-edit input').prop('checked', false);
          });
        });

      });

      return false;
    });

    $('body').on('click', '.all_pics__delete', function() {
      const $item = $(this).closest('.all_pics__item');
      const $input = $item.closest('div').prev();
      const id = $item.attr('data-id');
      const ids = $input.val().split(',');
      const index = ids.indexOf(id);
      if (index !== -1) ids.splice(index, 1);
      $input.val(ids);
      $item.remove();
      return false;
    });


  }

  function temporaryThumb(container, id, src) {
    const $li = window.allPic.makeThumb(id, src);
    container.append($li);
  }

  // Export helpers for the drag module (global scope safe)
  window.allPic = window.allPic || {};

  // Returns a jQuery <li> for an id+src, preferring cached markup
  window.allPic.makeThumb = function(id, src) {
    id = String(id).trim();
    const $store = $('#all_pic_store');

    // Prefer cached thumb (keeps consistent markup/icons)
    const $cached = $store.find(`[data-id="${id}"]`).first();
    if ($cached.length) return $cached.clone();

    // Fallback: build a thumb like your normal ones
    const $li = $(`
      <li class="all_pics__item" data-id="${id}">
        <img title="Drag (${id}) to relocate" src="${src || ''}" alt=""/>
        <p>
          <span class="all_pics__icon"><a class="ui-icon ui-icon-pencil all_pics__edit" href="#" title="${editText}">${editText}</a></span>
          <span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="${deleteText}">${deleteText}</a></span>
        </p>
      </li>
    `);

    // Persist to store for future refreshThumbsFromInput()
    if ($store.length && !$store.find(`[data-id="${id}"]`).length) {
      $store.append($li.clone());
    }

    return $li;
  };

  if (isChrome()) {
    $('body').addClass('is-chrome');
  }

});

function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function resyncFromUl($ul) {
  const order = $ul.children('.all_pics__item')
    .map(function() { return $(this).attr('data-id'); })
    .get()
    .join(',');

  // Standard galleries
  const $ct = $ul.closest('.all_pics_container');
  const $input = $ct.prev('input');

  if ($input.length) {
    $input.val(order);
    return;
  }

  // Shortcode gallery (in SideView header)
  if ($ul.closest('[data-name="shortcode"]').length) {
    $('#shortcode').val(order);
    const base = (window.allPicConfig && window.allPicConfig.shortcodeBase) || '';
    $('#shortcodeOut').val(`${base}id="${order}" />`);
  }
}


function insertThumbAtPoint($ul, $li, clientY) {
  const items = $ul.children('.all_pics__item').get();

  if (!items.length) {
    $ul.append($li);
    return;
  }

  // Insert before the first item whose midpoint is below the cursor
  for (const el of items) {
    const r = el.getBoundingClientRect();
    const mid = r.top + (r.height / 2);
    if (clientY < mid) {
      $(el).before($li);
      return;
    }
  }

  // Otherwise append at end
  $ul.append($li);
}


function initJQUSortable() {
  const $lists = $('.all_pics');

  // If we’re re-initializing (after async save / SideView open), destroy old instances
  try { $lists.filter('.ui-sortable').sortable('destroy'); } catch (e) {}

  $lists.sortable({
    connectWith: '.all_pics',
    items: '> .all_pics__item',
    placeholder: 'all_pics__placeholder',
    forcePlaceholderSize: true,
    tolerance: 'pointer',
    start: function() { $('body').addClass('allpic-dragging'); },
    stop: function() { $('body').removeClass('allpic-dragging'); },

    // When this UL changes (drop inside it), update its matching input
    update: function() {
      resyncFromUl($(this));
    },

    // When an item is received from another list, update both lists’ inputs
    receive: function(e, ui) {
      resyncFromUl($(this)); // destination
      if (ui.sender) resyncFromUl(ui.sender); // source
    }
  }).disableSelection();
}



window.allPicDrag = (function() {
  let dragging = null; // { id, src, $ghost }
  let moveHandler = null;
  let upHandler = null;

  // Placeholder state
  let $ph = null; // <li class="all_pics__placeholder">
  let $activeUL = null; // currently hovered UL

  function ensurePlaceholder() {
    if ($ph) return;
    $ph = $('<li class="all_pics__placeholder"></li>');
  }

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

    // Prefer UL, else fall back to container and grab its UL
    let ul = el.closest('.all_pics');
    if (!ul) {
      const ct = el.closest('.all_pics_container, #allpic-gallery-dialog, [data-name="shortcode"]');
      ul = ct ? ct.querySelector('.all_pics') : null;
    }

    if (!ul) { clearPlaceholder(); return; }

    const $ul = $(ul);

    if (!$activeUL || !$activeUL.is($ul)) {
      if ($activeUL) $activeUL.removeClass('allpic-dropzone-active');
      $activeUL = $ul.addClass('allpic-dropzone-active');
    }

    ensurePlaceholder();

    // Ensure placeholder is inside this UL
    if (!$ph.parent().is($ul)) {
      $ph.detach();
      $ul.append($ph);
    }

    // Compute insertion point by midpoint
    const items = $ul.children('.all_pics__item').get();

    if (!items.length) {
      // empty list: keep placeholder as only child
      if (!$ph.parent().is($ul)) $ul.append($ph);
      return;
    }

    for (const node of items) {
      const r = node.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (clientY < mid) {
        $(node).before($ph);
        return;
      }
    }
    // otherwise at end
    $ul.append($ph);
  }

  function begin({ id, src, startX, startY }) {
    if (!id) return;

    end(); // prevent duplicate drags
    dragging = { id: String(id), src: src || '' };

    const $ghost = $(`
      <div class="allpic-drag-ghost" style="position:fixed; z-index:99999; pointer-events:none;">
        <img src="${dragging.src}" style="max-width:64px; box-shadow:0 6px 18px rgba(0,0,0,.25);" />
      </div>
    `);
    $('body').append($ghost);
    dragging.$ghost = $ghost;

    // Position ghost immediately at start point (if provided)
    const x = (typeof startX === 'number') ? startX : window.innerWidth / 2;
    const y = (typeof startY === 'number') ? startY : window.innerHeight / 2;
    dragging.$ghost.css({ left: x + 12, top: y + 12 });

    // Highlight drop zones + prevent iframe stealing mouse events
    $('body').addClass('allpic-dragging');
    $('.all_pics').addClass('allpic-dropzone');

    // Place placeholder right away
    placePlaceholderAt(x, y);

    moveHandler = function(e) {
      dragging.$ghost.css({ left: e.clientX + 12, top: e.clientY + 12 });
      placePlaceholderAt(e.clientX, e.clientY);
    };

    upHandler = function(e) {
      dropAt(e.clientX, e.clientY);
      end();
    };

    document.addEventListener('mousemove', moveHandler, true);
    document.addEventListener('mouseup', upHandler, true);
  }

  function dropAt(x, y) {
    // Prefer dropping into the UL currently holding the placeholder
    const $ul = ($ph && $ph.parent().length) ? $ph.parent() : null;
    if (!$ul || !$ul.length) return;

    // 0) Gallery preview dialog: just insert thumb visually
    if ($ul.closest('#allpic-gallery-dialog').length) {
      if ($ul.find(`[data-id="${dragging.id}"]`).length) {
        clearPlaceholder();
        return;
      }
      const $thumb = window.allPic.makeThumb(dragging.id, dragging.src);
      $ph.replaceWith($thumb);
      clearPlaceholder();
      return;
    }

    // 1) SideView shortcode list
    if ($ul.closest('[data-name="shortcode"]').length) {
      const $input = $('#shortcode');
      const ids = ($input.val() || '').split(/[ ,]+/).map(s => s.trim()).filter(Boolean);
      if (!ids.includes(dragging.id)) ids.push(dragging.id);
      $input.val(ids.join(','));
    } else {
      // 2) Regular field list
      const $ct = $ul.closest('.all_pics_container');
      const $input = $ct.prev('input');
      if (!$input.length) {
        clearPlaceholder();
        return;
      }

      const ids = ($input.val() || '').split(/[ ,]+/).map(s => s.trim()).filter(Boolean);
      if (!ids.includes(dragging.id)) ids.push(dragging.id);
      $input.val(ids.join(','));
    }

    // Replace placeholder with the real thumb at exact placeholder position
    const $thumb = window.allPic.makeThumb(dragging.id, dragging.src);
    $ph.replaceWith($thumb);

    // Now sync whichever list we dropped into
    resyncFromUl($ul);

    clearPlaceholder();
  }

  function end() {
    if (!dragging) return;

    clearPlaceholder();

    if (dragging.$ghost) dragging.$ghost.remove();
    dragging = null;

    $('body').removeClass('allpic-dragging');
    $('.all_pics').removeClass('allpic-dropzone');

    if (moveHandler) document.removeEventListener('mousemove', moveHandler, true);
    if (upHandler) document.removeEventListener('mouseup', upHandler, true);

    moveHandler = null;
    upHandler = null;
  }

  return { begin, end };
})();


function agentHas(keyword) {
  return navigator.userAgent.toLowerCase().search(keyword.toLowerCase()) > -1;
}

function isChrome() {
  return agentHas("CriOS") || agentHas("Chrome") || !!window.chrome;
}
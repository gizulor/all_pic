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
  textpattern.Relay.register("txpAsyncForm.success", all_picjs);

  function all_picjs() {
    // add UI containers after each image field
    thumbFields.forEach(function(selector) {
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

    if (jQuery.ui) {
      $('.all_pics').sortable({
        update: function() {
          const imgOrder = $(this)
            .sortable('toArray', { attribute: 'data-id' })
            .toString();
          $(this).closest('div').prev().val(imgOrder);
        }
      });
    }



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

    $('body').on('click', '.all_pics__add, .all_pics__edit', function() {
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
        // Otherwise, create it fresh
        $('.txp-body').append(
          `<div id="sideView_container">
            <iframe id="sideView" src="${iframeUrl}" frameborder="0"></iframe>
          </div>`
        );
      }

      window.scrollTo(0, 0);


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
          <h5>Add selected images to:</h5>
          <ul>
            <li data-name="article-image"><a>${$('#txp-image-group-label').text()}</a></li>
            ${fields}
          </ul>
          <p><a id="all_pic__close" href="#">${closeText}</a></p>
          <div data-name="shortcode">
            or a <a>shortcode</a>
            <input type="text" hidden id="shortcode"/>
            <textarea id="shortcodeOut"></textarea>
            <ul class="all_pics"></ul>
          </div>
        </header>`;

      if ($('#sideView_container > header').length == 0) {
        $('#sideView_container').prepend(thumbHeader);
      }

      $('#all_pic__close').on('click', function() {
        $('#sideView_container').remove();
        return false;
      });


      $('#sideView').on('load', function() {
        const iframe = $('#sideView').contents();

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
        //iframe.find('head').append('<link rel="stylesheet" href="plugins/all_pic/side-view-overrides.css">');
        iframe.find('#current-page').remove();

        $('#sideView_container header [data-name]').each(function() {
          const fieldName = $(this).attr('data-name');
          const $targetInput = $('#' + fieldName);

          $(this).on('click', function() {
            const targetContainer = $targetInput.parent().find('.all_pics');
            const isShortcode = fieldName === 'shortcode';
            const ids = ($targetInput.val() || '').split(',');

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

              $('#sideView_container .all_pics').sortable({
                update: function() {
                  const order = $(this)
                    .sortable('toArray', { attribute: 'data-id' })
                    .toString()
                    .replace(/ ui-sortable-handle/g, '');
                  $targetInput.val(order);
                  $('#shortcodeOut').val(`${shortcodeBase}id="${order}" />`);
                }
              });
            }

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
    const thumbHtml = `
    <li class="all_pics__item" data-id="${id}">
      <img title="Drag to reorder" src="${src}" alt=""/>
      <p>
        <span class="all_pics__icon"><a class="ui-icon ui-icon-pencil all_pics__edit" href="#" title="${editText}">${editText}</a></span>
        <span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="${deleteText}">${deleteText}</a></span>
      </p>
    </li>
  `;

    container.append(thumbHtml);

    // Also append to the hidden store to persist through reloads
    const $store = $('#all_pic_store');
    if ($store.length && !$store.find(`[data-id="${id}"]`).length) {
      $store.append(thumbHtml);
    }

  }
});

function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
$(document).ready(function() {
  const prefs = window.allPicConfig || {};

  const thumbFields = prefs.thumbFields?.split(/[ ,]+/) || [];
  const shortcodeBase = prefs.shortcodeBase || '';
  const addImages = prefs.addImages || 'Add';
  const deleteText = prefs.deleteText || 'Delete';
  const editText = prefs.editText || 'Edit';
  const closeText = prefs.closeText || 'Close';

  // Create a combined jQuery object from all fields
  const $thumbInputs = $(thumbFields.join(','));

  all_picjs();
  textpattern.Relay.register("txpAsyncForm.success", all_picjs);

  function all_picjs() {
    // Add UI containers after each image field
    thumbFields.forEach(function(selector) {
      $(selector).after(
        `<div>
          <ul class="all_pics"></ul>
          <a class="all_pics__add" href="#" title="${addImages}">${addImages} <span class="ui-icon ui-icon-search"></span></a>
        </div>`
      );
    });

    thumbFields.forEach(function(selector) {
      const $field = $(selector);
    });

    $('body').append('<div id="all_pic_store">' + (prefs.thumb_markup || '') + '</div>');

    $('.all_pics').each(function() {
      const value = $(this).parent().prev().val();
      const container = $(this);
      container.empty();
      if (value) {
        const ids = value.split(/[ ,]+/);
        ids.forEach(function(id) {
          const idClass = `.id${id}`;
          $('#all_pic_store ' + idClass).clone().appendTo(container);
        });
      }
    });

    $('#all_pic_store').remove();

    if (jQuery.ui) {
      $('.all_pics').sortable({
        update: function() {
          const imgOrder = $(this)
            .sortable('toArray', { attribute: 'class' })
            .toString()
            .replace(/all_pics__item id/g, '')
            .replace(/ ui-sortable-handle/g, '');
          $(this).closest('div').prev().val(imgOrder);
        }
      });
    }

    $thumbInputs.on('input', debounce(function() {
      const $input = $(this);
      const container = $input.next().find('.all_pics');
      const value = $input.val().split(/[ ,]+/).map(s => s.trim()).filter(Boolean);

      const currentIds = container.find('.all_pics__item').map(function() {
        return this.className.replace(/.*id(\d+).*/, '$1');
      }).get();

      // Remove missing thumbs
      currentIds.forEach(id => {
        if (!value.includes(id)) {
          container.find(`.id${id}`).remove();
        }
      });

      const newIds = value.filter(id => !currentIds.includes(id));
      if (!newIds.length) return;

      // Fetch thumbs
      $.ajax({
        url: '/textpattern/index.php',
        method: 'POST',
        data: {
          event: 'all_pic',
          step: 'get_thumbs',
          ids: newIds.join(',')
        },
        success: function(html) {
          const $temp = $('<div>').html(html);
          newIds.forEach(function(id) {
            const $thumb = $temp.find(`.id${id}`);
            if ($thumb.length) {
              container.append($thumb);
            } else {
              console.warn(`No thumb found in Ajax for id ${id}`);
            }
          });
        },
        error: function(xhr) {
          console.error('Ajax thumb fetch failed:', xhr.responseText);
        }
      });
    }, 400));

    $('body').on('click', '.all_pics__add, .all_pics__edit', function() {
      // assign url to each
      const isAdd = $(this).hasClass('all_pics__add');
      const imageId = !isAdd ? $(this).closest('.all_pics__item').attr('class').replace(/.*id(\d+).*/, '$1') : '';
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

        iframe.find('head').append('<link rel="stylesheet" href="/textpattern/plugins/all_pic/side-view-overrides.css">');
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
                    .sortable('toArray', { attribute: 'class' })
                    .toString()
                    .replace(/all_pics__item id/g, '')
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
      const id = $item.attr('class').replace(/.*id(\d+).*/, '$1');
      const ids = $input.val().split(',');
      const index = ids.indexOf(id);
      if (index !== -1) ids.splice(index, 1);
      $input.val(ids);
      $item.remove();
      return false;
    });
  }

  function temporaryThumb(container, id, src) {
    container.append(
      `<li class="all_pics__item id${id}">
        <img src="${src}" />
        <p>
          <a class="ui-icon ui-icon-pencil all_pics__edit" href="#" title="${editText}">${editText}</a>
          <a class="ui-icon ui-icon-close all_pics__delete" href="#" title="${deleteText}">${deleteText}</a>
        </p>
      </li>`
    );
  }
});

function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
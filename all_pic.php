<?php
if(@txpinterface == 'admin') {
	register_callback('all_pic','article');
	register_callback('all_pic_css','admin_side','head_end');
	register_callback('all_pic_js_config', 'admin_side', 'head_end');
	register_callback('all_pic_js', 'admin_side', 'head_end');
	register_callback('all_pic_ajax_get_thumbs', 'all_pic', 'get_thumbs');
//register_callback('all_pic_ajax_get_thumbs', 'admin-ajax', 'all_pic_get_thumbs');
}

function all_pic_prefs() {
	return
		array(
			'thumbFields' => '#article-image, #custom-5,#custom-6', // fields to be used (comma separated | use #custom-n for custom fields)
			'shortcodeBase' => '<txp::gallery ', // your shortcode template (omit the tag-closer: />)
			'addImages' => gTxt('Add Images'), // text for "Choose images" link and button
			'deleteText' => gTxt('Delete image'), // text and title for "delete image" button
			'editText' => gTxt('Edit image'), // text and title for "edit image" button"
			'closeText' => gTxt('Close SideView'), // text for "Close SideView" link"
		);
}

function all_pic_js_config() {
	global $event;
	if ($event !== 'article') return;

	$prefs = all_pic_prefs();
	$prefs['thumb_markup'] = all_pic_build_thumb();

	echo '<script>';
	echo 'window.allPicConfig = ' . json_encode($prefs) . ';';
	echo '</script>';
}

function all_pic_js() {
	global $event;
	if ($event !== 'article') return;

	echo '<script defer src="/textpattern/plugins/all_pic/all_pic.js"></script>';
}

function all_pic_css() {
	global $event;
	if($event != 'article') {
		return;
	}
	echo '<link rel="stylesheet" href="/textpattern/plugins/all_pic/all_pic.css">';
}

function all_pic_render_thumbs(array $ids = []) {
	$image_path = hu . get_pref('img_dir');
	$prefs = all_pic_prefs();
	$markup = [];

	$ids = array_filter($ids, 'is_numeric');
	if (empty($ids)) return '';

	$escaped = implode(',', array_map('intval', $ids));
	$rs = safe_rows('ext,id,thumbnail', 'txp_image', 'id IN (' . $escaped . ')');

	if ($rs) {
		$rnd_number = '?' . time();

		foreach ($rs as $a) {
			extract($a);
			$image = ($thumbnail == 0) ? $id . $ext . $rnd_number : $id . 't' . $ext . $rnd_number;

			$markup[] =
				'<li class="all_pics__item id' . $id . '">' .
				'<img src="' . $image_path . '/' . $image . '" alt="" />' .
				'<p>' .
				'<a class="ui-icon ui-icon-pencil all_pics__edit" href="#" title="' . $prefs['editText'] . '">' . $prefs['editText'] . '</a>' .
				'<a class="ui-icon ui-icon-close all_pics__delete" href="#" title="' . $prefs['deleteText'] . '">' . $prefs['deleteText'] . '</a>' .
				'</p>' .
				'</li>';
		}
	}

	return implode('', $markup);
}

function all_pic_build_thumb() {
	global $prefs, $step;
	extract(all_pic_prefs());

	$article_id = gps('ID');
	$fields_array = explode(",", $thumbFields);
	for ($i = 0; $i < count($fields_array); $i++) {
		$current_field = trim($fields_array[$i]);
		$current_field = ($current_field === '#article-image') ? 'Image' : str_replace('#custom-', 'custom_', $current_field);
		$fields_array[$i] = $current_field;
	}

	if ($step == 'edit' && $article_id) {
		$fields_string = implode(',', $fields_array);
		$values = safe_row($fields_string, 'textpattern', 'ID = '. $article_id);
	}
	elseif ($step == 'create' || $step == 'edit') {
		for ($i = 0; $i < count($fields_array); $i++) {
			$current = $fields_array[$i];
			$values[] = gps($current);
		}
	}

	$values = array_filter(array_values($values));
	$values = explode(',', implode(',', $values));

	$ids = [];

	foreach ($values as $group) {
		if (!empty($group) && is_numeric($group)) {
			$ids[] = trim($group);
		}
	}

	return all_pic_render_thumbs($ids);
}

function all_pic () {
	global $event;

	if($event != 'article') {
		return;
	}
	extract(all_pic_prefs());
	$all_pic_build_thumb = all_pic_build_thumb();

}


function all_pic_ajax_get_thumbs()
{
	// if (!is_logged_in()) {
	// 	exit('Not authorized');
	// }
//
	// if (!has_privs('article.edit')) return;
//
	// $ids = gps('ids');
	// if (!$ids) return;
//
	// $idArray = explode(',', $ids);
	// $markup = all_pic_render_thumbs($idArray);
	// echo $markup;
	// exit;


	if (!is_logged_in()) {
			exit('Not authorized');
	}

	$ids = gps('ids');
	if (!$ids) {
			exit('No IDs provided');
	}

	$idArray = explode(',', $ids);
	echo all_pic_render_thumbs($idArray);
	exit;

	// 	header('Content-Type: text/plain');
	// echo "THUMB AJAX WORKS!";
	// exit;

}
/*
<media-theme-optiflowz-theme>
  <video
    slot="media"
    src="https://stream.mux.com/fXNzVtmtWuyz00xnSrJg4OJH6PyNo6D02UzmgeKGkP5YQ/high.mp4"
  ></video>
</media-theme-optiflowz-theme>
*/

import 'media-chrome';
import { globalThis } from 'media-chrome/dist/utils/server-safe-globals.js';
import { MediaThemeElement } from 'media-chrome/dist/media-theme-element.js';
import 'media-chrome/dist/menu/index.js';

const template = globalThis.document?.createElement?.('template');
if (template) {
  template.innerHTML = String.raw/*html*/`
    <!-- Optiflowz Theme -->
    <style>
      :host {
        --_primary-color: var(--media-primary-color, white);
        --_secondary-color: var(--media-secondary-color, transparent);
        --_accent-color: var(--media-accent-color, white);
      }

      .displayNone{
        display: none !important;
      }

      media-controller {
        position: relative;
        --base: 18px;

        --media-control-hover-background: rgba(255, 255, 255, 0.1);
        --media-tooltip-background: rgb(0 0 0 / .5);
        --media-text-content-height: 1.2;
        --media-tooltip-padding: .7em 1em;
        --media-tooltip-distance: 8px;
        --media-tooltip-container-margin: 18px;

        font-size: calc(0.75 * var(--base));
    font-family: 'Gabarito', Roboto, Arial, sans-serif;
    --media-font-family: 'Gabarito', Roboto, helvetica neue, segoe ui, arial, sans-serif;
        -webkit-font-smoothing: antialiased;

        --media-primary-color: #fff;
        --media-secondary-color: transparent;
        --media-menu-background: rgba(28, 28, 28, 0.6);
        --media-text-color: var(--_primary-color);
        --media-control-hover-background: var(--media-secondary-color);

        --media-range-track-height: calc(0.2 * var(--base));
        --media-range-chapter-gap: calc(0.1 * var(--base));
        --media-range-thumb-height: calc(0.3 * var(--base));
        --media-range-thumb-width: calc(0.3 * var(--base));
        --media-range-thumb-border-radius: var(--base);
        --media-range-segments-gap: 4px;

        --media-control-height: calc(2 * var(--base));
      }

      ::slotted([slot='media']),
      ::slotted(video),
      ::slotted(mux-player) {
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      @supports (-moz-appearance: none) {
        media-controller {
          height: 100%;
          min-height: 0;
        }

        ::slotted([slot='media']),
        ::slotted(video),
        ::slotted(mux-player) {
          min-height: 0;
          max-height: 100%;
        }
      }

      media-controller[breakpointmd] {
        --base: 20px;
      }

      /* The biggest size controller is tied to going fullscreen
          instead of a player width. */
      media-controller[mediaisfullscreen] {
        --base: 26px;
      }

      .media-button {
        --media-control-hover-background: rgba(255, 255, 255, 0.1);
        --media-text-content-height: 1.2;
        --media-tooltip-padding: .7em 1em;
        --media-tooltip-distance: 8px;
        --media-tooltip-container-margin: 18px;
        --media-text-content-height: 1.2;
        position: relative;
        padding: 0;
        transition: opacity 0.1s cubic-bezier(0.4, 0, 1, 1);
      }

      .media-button svg {
        fill: none;
        stroke: var(--_primary-color);
        stroke-width: 1;
        stroke-linecap: 'round';
        stroke-linejoin: 'round';
      }

      svg .svg-shadow {
        stroke: #000;
        stroke-opacity: 0.15;
        stroke-width: 2px;
        fill: none;
      }

      .center {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: calc(0.75 * var(--base));
      }

      .center media-play-button,
      .center media-seek-backward-button,
      .center media-seek-forward-button{
        display: flex;
        align-items: center;
        justify-content: center;
        gap: calc(0.1 * var(--base));
        background-color: rgba(0, 0, 0, 0.5);
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        margin-bottom: calc(1.5 * var(--base));
      }

      .center media-play-button{
        padding: calc(0.65 * var(--base));
      }

      .center media-seek-backward-button,
      .center media-seek-forward-button{
        width: calc(2.25 * var(--base));
        height: calc(2.25 * var(--base));
        min-width: calc(2.25 * var(--base));
        min-height: calc(2.25 * var(--base));
        padding: calc(0.4 * var(--base));
        border-radius: 50%;
        flex: 0 0 calc(2.25 * var(--base));
      }

      media-controller[breakpointlg] .center media-play-button,
      media-controller[breakpointlg] .center media-seek-backward-button,
      media-controller[breakpointlg] .center media-seek-forward-button{
        display: none;
      }

      .center media-play-button svg{
        width: calc(2.05 * var(--base));
        height: calc(2.05 * var(--base));
      }

      .center media-seek-backward-button svg,
      .center media-seek-forward-button svg{
        width: calc(1.2 * var(--base));
        height: calc(1.2 * var(--base));
      }

      .center media-play-button svg path{
        fill: none;
        stroke: white;
        stroke-width: 2;
      }

      .center media-seek-backward-button svg path,
      .center media-seek-forward-button svg path,
      .center media-seek-backward-button svg text,
      .center media-seek-forward-button svg text{
        fill: none;
        stroke: white;
        stroke-width: 1.8;
      }

      .center media-seek-backward-button svg text,
      .center media-seek-forward-button svg text{
        fill: white;
        stroke: none;
        font-size: 6px;
        font-weight: 700;
    font-family: 'Gabarito', Roboto, Arial, sans-serif;
      }
    </style>

    <media-controller
      breakpoints="sm:384 md:480 lg:705 xl:768 xxl:1075"
      defaultsubtitles="{{defaultsubtitles}}"
      defaultduration="{{defaultduration}}"
      gesturesdisabled="{{disabled}}"
      hotkeys="{{hotkeys}}"
      nohotkeys="{{nohotkeys}}"
      defaultstreamtype="on-demand"
    >
      <slot name="media" slot="media"></slot>
      <slot name="poster" slot="poster"></slot>
      <slot name="centered-chrome" slot="centered-chrome"></slot>
      <media-error-dialog slot="dialog"></media-error-dialog>

      <div class="center" slot="centered-chrome">
        <media-seek-backward-button seekoffset="10"></media-seek-backward-button>
        <media-play-button mediapaused>
          <svg slot="icon" viewBox="0 0 24 24">
            <!-- <use class="svg-shadow" xlink:href="#icon-play"></use> -->
            <g>
              <path id="icon-play" d="M7.54553 13.4287V10.5713C7.54553 8.74427 7.54553 7.83075 7.92908 7.30433C8.2636 6.84521 8.77757 6.54999 9.34271 6.49239C9.99067 6.42633 10.7798 6.88663 12.3579 7.80722L14.8071 9.23591C16.3642 10.1442 17.1428 10.5984 17.4048 11.1898C17.6334 11.7057 17.6334 12.2943 17.4048 12.8102C17.1428 13.4016 16.3642 13.8558 14.8071 14.7641L12.3579 16.1928L12.3579 16.1928C10.7798 17.1134 9.99067 17.5737 9.34271 17.5076C8.77757 17.45 8.2636 17.1548 7.92908 16.6957C7.54553 16.1693 7.54553 15.2557 7.54553 13.4287Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </g>
            <g id="icon-pause">
              <path id="pause-left" d="M7 16V8C7 7.44772 7.44772 7 8 7H9C9.55228 7 10 7.44772 10 8V16C10 16.5523 9.55228 17 9 17H8C7.44772 17 7 16.5523 7 16Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path id="pause-right" d="M14 16V8C14 7.44772 14.4477 7 15 7H16C16.5523 7 17 7.44772 17 8V16C17 16.5523 16.5523 17 16 17H15C14.4477 17 14 16.5523 14 16Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </g>
          </svg>
        </media-play-button>
        <media-seek-forward-button seekoffset="10"></media-seek-forward-button>
      </div>

      <div class="media-gradient-top"></div>
      <media-text-display class="topTitle" slot="top-chrome">
        <p>{{videotitlee ?? ''}}</p>
        <span>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8V8.5M12 12V16M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="popup">
            Content available on this platform may be subject to third-party rights. Please do not copy, download, or redistribute any material unless you have permission from the relevant rights holder.
          </div>
        </span>
      </media-text-display>

      <!-- Controls Gradient -->
      <style>
        .topTitle {
          position: absolute;
          top: calc(0.3 * var(--base));
          left: 0;
          font-size: calc(0.85 * var(--base));
          font-weight: 500;
          width: 100%;
          z-index: 1;
          display: none;
          align-items: center;
          justify-content: flex-start;
          margin-left: calc(0.5 * var(--base));
        }

        .topTitle p{
          pointer-events: none;
          margin: 0;
        }

        .topTitle > span {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: 5px;
        }

        .popup {
          position: absolute;
          top: calc(2 * var(--base));
          left: 0;
          max-width: calc(100% - 2.5 * var(--base));
          width: calc(35 * var(--base));
    font-family: 'Gabarito';
          padding: calc(0.75 * var(--base));
          border-radius:  calc(0.75 * var(--base));
          background-color: rgba(0, 0, 0, 0.72);
          will-change: transform, opacity, height;
          border: 1px solid rgba(255, 255, 255, 0.12);
          font-size: calc(0.8 * var(--base));
          text-align: left;
          opacity: 0;
          pointer-events: none;
          will-change: transform;
          transform: translateY(-5px);
          transition: opacity .24s ease, transform .24s ease;
        }

        .topTitle > span:hover .popup {
          opacity: 1;
          transform: translateY(0);
        }

        .popup span {
          color: #ec8b55;
        }

        media-controller[breakpointlg] .topTitle {
          display: flex;
        }

        .media-gradient-top{
          position: absolute;
          top: 0;
          width: 100%;
          height: calc(4.5 * var(--base));
          pointer-events: none;
          display: none;
        }

        media-controller[breakpointlg] .media-gradient-top {
          display: block;
        }

        .media-gradient-top::before {
          content: '';
          --gradient-steps: hsl(0 0% 0% / 0) 0%, hsl(0 0% 0% / 0.013) 8.1%, hsl(0 0% 0% / 0.049) 15.5%,
            hsl(0 0% 0% / 0.104) 22.5%, hsl(0 0% 0% / 0.175) 29%, hsl(0 0% 0% / 0.259) 35.3%, hsl(0 0% 0% / 0.352) 41.2%,
            hsl(0 0% 0% / 0.45) 47.1%, hsl(0 0% 0% / 0.55) 52.9%, hsl(0 0% 0% / 0.648) 58.8%, hsl(0 0% 0% / 0.741) 64.7%,
            hsl(0 0% 0% / 0.825) 71%, hsl(0 0% 0% / 0.896) 77.5%, hsl(0 0% 0% / 0.951) 84.5%, hsl(0 0% 0% / 0.987) 91.9%,
            hsl(0 0% 0%) 100%;

          position: absolute;
          inset: 0;
          opacity: 0.6;
          background: linear-gradient(to top, var(--gradient-steps));
        }

        .media-gradient-bottom {
          position: absolute;
          bottom: 0;
          width: 100%;
          height: calc(8 * var(--base));
          pointer-events: none;
        }

        .media-gradient-bottom::before {
          content: '';
          --gradient-steps: hsl(0 0% 0% / 0) 0%, hsl(0 0% 0% / 0.013) 8.1%, hsl(0 0% 0% / 0.049) 15.5%,
            hsl(0 0% 0% / 0.104) 22.5%, hsl(0 0% 0% / 0.175) 29%, hsl(0 0% 0% / 0.259) 35.3%, hsl(0 0% 0% / 0.352) 41.2%,
            hsl(0 0% 0% / 0.45) 47.1%, hsl(0 0% 0% / 0.55) 52.9%, hsl(0 0% 0% / 0.648) 58.8%, hsl(0 0% 0% / 0.741) 64.7%,
            hsl(0 0% 0% / 0.825) 71%, hsl(0 0% 0% / 0.896) 77.5%, hsl(0 0% 0% / 0.951) 84.5%, hsl(0 0% 0% / 0.987) 91.9%,
            hsl(0 0% 0%) 100%;

          position: absolute;
          inset: 0;
          opacity: 0.5;
          background: linear-gradient(to bottom, var(--gradient-steps));
        }
      </style>
      <div class="media-gradient-bottom"></div>

      <!-- Time Range / Progress Bar -->
        <style>
          media-time-range {
              position: absolute;
              bottom: calc(2.1 * var(--base));
              left: calc(0.25 * var(--base));
              height: calc(2 * var(--base));
              width: calc(100% - 0.5 * var(--base));
              border-radius: calc(0.25 * var(--base));

            --media-range-track-background: rgba(0, 0, 0, 0.6);
            --media-range-track-border-radius: calc(0.25 * var(--base));

            --media-time-range-buffered-color: rgba(255, 255, 255, 0.5);
            --media-range-bar-color: var(--media-accent-color);

            --media-range-thumb-background: var(--media-accent-color);
            --media-range-thumb-transition: opacity 0.1s linear;
            --media-range-thumb-opacity: 0;

            --media-preview-thumbnail-border: calc(0.125 * var(--base)) solid #fff;
            --media-preview-thumbnail-border-radius: calc(0.5 * var(--base));
            --media-preview-thumbnail-min-width: calc(8 * var(--base));
            --media-preview-thumbnail-max-width: calc(10 * var(--base));
            --media-preview-thumbnail-min-height: calc(5 * var(--base));
            --media-preview-thumbnail-max-height: calc(7 * var(--base));
            --media-preview-box-margin: 0 0 -10px;
          }

          media-preview-thumbnail {
            margin-bottom: 5px;
          }

          media-preview-chapter-display {
            font-size: calc(0.6 * var(--base));
            padding-block: 0;
          }

          media-preview-time-display {
            font-size: calc(0.65 * var(--base));
            padding-top: 0;
          }
        </style>
        <media-time-range>
          <media-preview-thumbnail></media-preview-thumbnail>
          <media-preview-chapter-display></media-preview-chapter-display>
          <media-preview-time-display></media-preview-time-display>
        </media-time-range>

      <!-- Settings Menu -->
      <style>
        media-settings-menu {
          --media-menu-icon-height: 20px;
          --media-menu-item-icon-height: 20px;
          --media-settings-menu-min-width: calc(10 * var(--base));
          --media-menu-transform-in: translateY(0) scale(1);
          --media-menu-transform-out: translateY(15px) scale(1);
          padding-block: calc(0.15 * var(--base));
          background-color: rgba(0, 0, 0, 0.68);
          will-change: transform, opacity, height;
          border: 1px solid rgba(255, 255, 255, 0.12);
          margin-right: 18px;
          margin-bottom: 8px;
          border-radius: 24px;
          z-index: 2;
          user-select: none;
        }

        media-settings-menu-item,
        [role='menu']::part(menu-item) {
          --media-icon-color: var(--_primary-color);
          margin-inline: calc(0.45 * var(--base));
          height: calc(1.6 * var(--base));
          font-size: calc(0.6 * var(--base));
          font-weight: 400;
          padding: 0;
          padding-left: calc(0.5 * var(--base));
          padding-right: calc(0.2 * var(--base));
          border-radius: 999px;
          border: 1px solid transparent;
          text-shadow: none;
          flex-shrink: 0;
          transition: background-color .2s ease, border-color .2s ease;
        }

        [slot='submenu']::part(back button) {
          font-size: calc(0.6 * var(--base));
          padding-top: calc(0.6 * var(--base));
          transition: background .2s ease;
        }

        [slot='submenu']::part(back button):hover{
          background: rgba(255, 255, 255, 0.1);
        }

        media-settings-menu-item:hover {
          --media-icon-color: var(--_primary-color);
          color: var(--_primary-color);
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.18);
        }

        media-settings-menu-item:hover [slot='submenu']::part(menu-item),
        [slot='submenu']::part(back indicator) {
          --media-icon-color: var(--_primary-color);
        }

        media-settings-menu-item:hover [slot='submenu']::part(menu-item):hover {
          --media-icon-color: var(--_primary-color);
          color: var(--_primary-color);
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.18);
        }

        media-settings-menu-item[submenusize='0'] {
          display: none;
        }

        /* Also hide if only 'Auto' is added. */
        .quality-settings[submenusize='1'] {
          display: none;
        }
      </style>
      <media-settings-menu hidden anchor="auto">
        <media-settings-menu-item>
          Playback Speed
          <media-playback-rate-menu slot="submenu" hidden>
            <div slot="title">Playback Speed</div>
          </media-playback-rate-menu>
        </media-settings-menu-item>
        <media-settings-menu-item class="quality-settings">
          Quality
          <media-rendition-menu slot="submenu" hidden>
            <div slot="title">Quality</div>
          </media-rendition-menu>
        </media-settings-menu-item>
        <media-settings-menu-item>
          Subtitles/CC
          <media-captions-menu slot="submenu" hidden>
            <div slot="title">Subtitles/CC</div>
          </media-captions-menu>
        </media-settings-menu-item>
      </media-settings-menu>

      <!-- Control Bar -->
      <style>
        media-control-bar {
          position: absolute;
          height: calc(2 * var(--base));
          line-height: calc(2 * var(--base));
          bottom: calc(0.5 * var(--base));
          left: calc(0.5 * var(--base));
          right: calc(0.5 * var(--base));
        }
      </style>
      <media-control-bar>
      <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
        <div style="display: flex; width: 100%; align-items: center; gap: calc(0.2 * var(--base))">
          <div class="player-button-group play">
            <!-- Play/Pause -->
            <style>
              .media-button {
                border-radius: 50%;
                background-color: transparent;
                border: 1px solid transparent;
                transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
              }

              .media-button:hover {
                /* background-color: rgba(255, 255, 255, 0.1); */
                /*box-shadow: rgba(0, 0, 0, 0.3) 0px 0px 5px; */
                /* hue-rotate(120deg) */
                background-color: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.18);
              }

              media-play-button #icon-play {
                opacity: 0;
                transform-box: view-box;
                transform-origin: center center;
                transform: scale(0.88);
                transition: opacity 0.18s ease, transform 0.18s ease;
              }

              media-play-button[mediapaused] #icon-play {
                opacity: 1;
                transform: scale(1);
              }

              media-play-button #icon-pause {
                transform-origin: center center;
                transition: opacity 0.18s ease, transform 0.18s ease;
              }

              media-play-button:not([mediapaused]) #icon-pause {
                opacity: 1;
                transform: scale(1);
              }

              media-play-button[mediapaused] #icon-pause {
                opacity: 0;
                transform-box: view-box;
                transform: scale(0.88);
              }
            </style>
            <media-play-button mediapaused class="media-button custom-btn custom-play">
              <svg slot="icon" viewBox="0 0 24 24">
                <!-- <use class="svg-shadow" xlink:href="#icon-play"></use> -->
                <g>
                  <path id="icon-play" d="M7.54553 13.4287V10.5713C7.54553 8.74427 7.54553 7.83075 7.92908 7.30433C8.2636 6.84521 8.77757 6.54999 9.34271 6.49239C9.99067 6.42633 10.7798 6.88663 12.3579 7.80722L14.8071 9.23591C16.3642 10.1442 17.1428 10.5984 17.4048 11.1898C17.6334 11.7057 17.6334 12.2943 17.4048 12.8102C17.1428 13.4016 16.3642 13.8558 14.8071 14.7641L12.3579 16.1928L12.3579 16.1928C10.7798 17.1134 9.99067 17.5737 9.34271 17.5076C8.77757 17.45 8.2636 17.1548 7.92908 16.6957C7.54553 16.1693 7.54553 15.2557 7.54553 13.4287Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </g>
                <g id="icon-pause">
                  <path id="pause-left" d="M7 16V8C7 7.44772 7.44772 7 8 7H9C9.55228 7 10 7.44772 10 8V16C10 16.5523 9.55228 17 9 17H8C7.44772 17 7 16.5523 7 16Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path id="pause-right" d="M14 16V8C14 7.44772 14.4477 7 15 7H16C16.5523 7 17 7.44772 17 8V16C17 16.5523 16.5523 17 16 17H15C14.4477 17 14 16.5523 14 16Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
              </svg>
            </media-play-button>
          </div>
          <div class="player-button-group">
            <!-- Volume/Mute -->
            <style>
              media-mute-button {
                position: relative;
              }

              media-mute-button #high-vol-path {
                display: block;
              }

              media-mute-button #muted-path{
                display: none;
              }

              media-mute-button[mediavolumelevel='off'] #muted-path {
                display: block;
              }

              media-mute-button[mediavolumelevel='off'] #high-vol-path {
                display: none;
              }

              media-volume-range {
                transition: opacity .2s ease-in-out .1s, width .2s ease-in-out .1s;

                width: 0;
                height: calc(1.2 * var(--base));
                padding: 0;
                border-radius: calc(0.25 * var(--base));
                overflow: hidden;

                --media-range-bar-color: var(--media-accent-color);

                --media-range-padding-left: 0;
                --media-range-padding-right: 0;

                --media-volume-range-display: block;

                --media-range-track-width: calc(2.9 * var(--base));
                --media-range-track-height: calc(0.25 * var(--base));
                --media-range-track-border-radius: calc(0.25 * var(--base));

                --media-range-thumb-width: calc(0.35 * var(--base));
                --media-range-thumb-height: calc(0.35 * var(--base));
                --media-range-thumb-border-radius: 100%;
              }

              .player-button-group:has(media-mute-button:hover) media-volume-range,
              .player-button-group:has(media-mute-button) media-volume-range:hover {
                width: calc(3.4 * var(--base));
                transition-delay: 0s;
                padding-inline: calc(0.3 * var(--base));
              }

              .player-button-group:has(media-mute-button:hover) media-time-display,
              .player-button-group:has(media-mute-button):has(media-volume-range:hover) media-time-display {
                margin-left: 0;
                transition-delay: 0s;
              }

              [keyboardcontrol] media-volume-range:focus {
                /* TODO: This appears to be creating a think outline */
                outline: 1px solid rgba(27, 127, 204, 0.9);
              }

              /* When keyboard navigating the volume range and wrapper need to always be visible
                otherwise focus state can't land on it. This is ok when keyboard navigating because
                the hovering issues aren't a concern, unless you happen to be keyboard AND mouse navigating.
              */
              [keyboardcontrol] .media-volume-range-wrapper,
              [keyboardcontrol] .media-volume-range-wrapper:focus-within,
              [keyboardcontrol] .media-volume-range-wrapper:focus-within media-volume-range {
                visibility: visible;
              }
            </style>
            <media-mute-button class="media-button custom-btn">
              <use class="svg-shadow" xlink:href="#vol-paths"></use>
              <svg slot="icon" viewBox="0 0 24 24">
                <path d="M11.0438 5.91L7.04376 9.1125C6.81499 9.29837 6.54503 9.39765 6.26876 9.3975H5.18751C4.81844 9.39551 4.46392 9.57004 4.20236 9.88251C3.9408 10.195 3.79376 10.6196 3.79376 11.0625V12.9375C3.79376 13.3804 3.9408 13.805 4.20236 14.1175C4.46392 14.43 4.81844 14.6045 5.18751 14.6025H6.26876C6.54503 14.6024 6.81499 14.7016 7.04376 14.8875L11.0438 18.09C11.4708 18.4289 12.0182 18.4595 12.4697 18.1698C12.9212 17.8802 13.2039 17.3168 13.2063 16.7025V7.2975C13.2039 6.68318 12.9212 6.11983 12.4697 5.83016C12.0182 5.5405 11.4708 5.57115 11.0438 5.91Z" stroke="white" stroke-width="2"/>
                <g id="high-vol-path" clip-path="url(#clip1_2964_39)">
                  <path d="M16.5174 9.10336C18.1171 10.7031 18.1171 13.2968 16.5174 14.8966M18.6898 6.93091C21.4894 9.73047 21.4894 14.2695 18.6898 17.069" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
                <g id="muted-path">
                  <path d="M17 10L21 14M21 10L17 14" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
                <clipPath id="clip1_2964_39">
                  <rect width="12.2892" height="12.2892" fill="white" transform="translate(18.6898 3.31018) rotate(45)"/>
                </clipPath>
              </svg>
            </media-mute-button>
            <div class="media-volume-range-wrapper">
              <media-volume-range></media-volume-range>
            </div>

            <!-- Time Display -->
            <style>
              media-time-display {
                transition: margin .2s ease-in-out .1s;
                position: relative;
                padding: calc(0.5 * var(--base));
                margin-left: calc(-0.7 * var(--base));
                font-size: calc(0.7 * var(--base));
                font-weight: 500;
                height: calc(1.5 * var(--base));
                border-radius: calc(0.5 * var(--base));
              }

              media-controller{
                --media-webkit-text-track-transform: translateY(calc(-1 * var(--base))) scale(1);
                --media-webkit-text-track-transition: transform 0.2s ease;
              }

              media-controller:is([mediapaused], :not([userinactive])){
                --media-webkit-text-track-transform: translateY(calc(-3.5 * var(--base))) scale(0.98);
              }

              media-controller:not([breakpointlg]) .currentChapter {
                display: none;
              }

              media-controller[breakpointlg] .currentChapter {
                display: inline-flex;
              }

              media-controller[breakpointmd] media-time-display:not([showduration]) {
                display: none;
              }

              media-controller:not([breakpointmd]) media-time-display[showduration] {
                display: none;
              }
            </style>
            <media-time-display></media-time-display>
            <media-time-display showduration></media-time-display>
          </div>

          <div class="player-button-group currentChapter">
            <style>
                media-current-chapter{
                  transition: background-color .2s ease-in-out, border-color .2s ease-in-out, opacity .2s ease-in-out;
                  height: fit-content;
                  display: flex;
                  align-items: center;
                  gap: calc(0.2 * var(--base));
                  cursor: pointer;
                  border-radius: 9999px;
                  border: 1px solid transparent;
                }
                media-current-chapter:hover{
                  background: rgba(255, 255, 255, 0.1);
                  border-color: rgba(255, 255, 255, 0.18);
                }

              media-current-chapter p{
                display: block;
                align-items: center;
                margin: 0;
                font: var(--media-font, var(--media-font-weight, normal) var(--media-font-size, 14px) / var(--media-text-content-height, var(--media-control-height, 24px)) var(--media-font-family));
                font-size: calc(0.7 * var(--base));
                font-weight: 500;
                padding-left: calc(0.5 * var(--base));
                height: calc(1.65 * var(--base));
                line-height: 2.4;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                min-width: 0;
                max-width: calc(10 * var(--base));
              }
            </style>
            <media-current-chapter id="media-current-chapter">
            <media-tooltip placement="top">Chapter</media-tooltip>
              <p>Chapters loading...</p>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clip-path="url(#clip0_2964_39)">
                <path d="M9 6L14.2929 11.2929C14.6834 11.6834 14.6834 12.3166 14.2929 12.7071L9 18" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
                <defs>
              </svg>
            </media-current-chapter>
          </div>
        </div>

          <div class="player-button-group">
            <!-- Subtitles/CC Button -->
            <style>
              .player-button-group{
                display: flex;
                align-items: center;
                gap: calc(0.1 * var(--base));
                background-color: rgba(0, 0, 0, 0.5);
                border-radius: 9999px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                padding: calc(0.2 * var(--base));
              }

              .player-button-group.play {
                // padding-inline: 0px;
                // margin-right: calc(0.4 * var(--base));
              }

              .player-button-group media-tooltip{
                opacity: 0;
                transtition: opacity .3s;
              }

              .player-button-group.currentChapter:hover media-tooltip{
                opacity: 1;
              }

              media-theater-mode-button:hover media-tooltip{
                opacity: 1;
              }

              media-captions-button {
                position: relative;
              }

              media-controller:not([breakpointmd]) media-captions-button {
                display: none;
              }

              media-captions-button svg :is(path, rect) {
                stroke: none;
                fill: var(--_primary-color);
              }

              /* Disble the captions button when no subtitles are available */
              media-captions-button:not([mediasubtitleslist]) svg {
                opacity: 0.3;
              }

              media-captions-button #cc-underline {
                opacity: 1;
              }

              media-captions-button[mediasubtitleslist][aria-checked='true'] #cc-underline {
                opacity: 1;
              }

              media-captions-button #cc-underline {
                transition: clip-path 0.15s ease-out;
              }

              media-captions-button #cc-underline {
                clip-path: inset(0 100% 0 0);
              }

              media-captions-button[aria-checked='true'] #cc-underline {
                clip-path: inset(0 0 0 0);
              }
            </style>
            <media-captions-button class="media-button custom-btn">
              <svg slot="icon" viewBox="0 0 24 24">
                <use class="svg-shadow" xlink:href="#cc-icon"></use>
                <g id="cc-icon">
                  <path d="M11.2804 9.12926H9.72923C9.66957 8.79782 9.55853 8.50615 9.39613 8.25426C9.23372 8.00237 9.03486 7.78859 8.79954 7.61293C8.56422 7.43726 8.30072 7.30469 8.00906 7.2152C7.7207 7.12571 7.41412 7.08097 7.08931 7.08097C6.50266 7.08097 5.97733 7.22846 5.51332 7.52344C5.05262 7.81842 4.68803 8.25095 4.41957 8.82102C4.15442 9.3911 4.02184 10.0871 4.02184 10.9091C4.02184 11.7377 4.15442 12.437 4.41957 13.0071C4.68803 13.5772 5.05427 14.008 5.51829 14.2997C5.9823 14.5914 6.50432 14.7372 7.08434 14.7372C7.40584 14.7372 7.71076 14.6941 7.99911 14.608C8.29078 14.5185 8.55427 14.3875 8.7896 14.2152C9.02492 14.0429 9.22378 13.8324 9.38619 13.5838C9.55191 13.3319 9.66625 13.0436 9.72923 12.7188L11.2804 12.7237C11.1975 13.2242 11.0368 13.6849 10.7981 14.1058C10.5628 14.5234 10.2595 14.8847 9.88832 15.1896C9.52042 15.4912 9.09949 15.7249 8.62553 15.8906C8.15157 16.0563 7.63453 16.1392 7.0744 16.1392C6.19277 16.1392 5.40726 15.9304 4.71786 15.5128C4.02847 15.0919 3.48491 14.4903 3.08718 13.7081C2.69277 12.9259 2.49556 11.9929 2.49556 10.9091C2.49556 9.82197 2.69442 8.88897 3.09215 8.11008C3.48988 7.32789 4.03344 6.72798 4.72283 6.31037C5.41223 5.88944 6.19608 5.67898 7.0744 5.67898C7.61464 5.67898 8.11843 5.75687 8.58576 5.91264C9.0564 6.0651 9.47899 6.29048 9.85352 6.58878C10.228 6.88376 10.5379 7.24503 10.7832 7.67258C11.0285 8.09683 11.1942 8.58239 11.2804 9.12926ZM21.5753 9.12926H20.0241C19.9645 8.79782 19.8535 8.50615 19.6911 8.25426C19.5286 8.00237 19.3298 7.78859 19.0945 7.61293C18.8591 7.43726 18.5956 7.30469 18.304 7.2152C18.0156 7.12571 17.709 7.08097 17.3842 7.08097C16.7976 7.08097 16.2723 7.22846 15.8082 7.52344C15.3475 7.81842 14.983 8.25095 14.7145 8.82102C14.4493 9.3911 14.3168 10.0871 14.3168 10.9091C14.3168 11.7377 14.4493 12.437 14.7145 13.0071C14.983 13.5772 15.3492 14.008 15.8132 14.2997C16.2772 14.5914 16.7992 14.7372 17.3793 14.7372C17.7008 14.7372 18.0057 14.6941 18.294 14.608C18.5857 14.5185 18.8492 14.3875 19.0845 14.2152C19.3198 14.0429 19.5187 13.8324 19.6811 13.5838C19.8468 13.3319 19.9612 13.0436 20.0241 12.7188L21.5753 12.7237C21.4924 13.2242 21.3317 13.6849 21.093 14.1058C20.8577 14.5234 20.5545 14.8847 20.1832 15.1896C19.8153 15.4912 19.3944 15.7249 18.9205 15.8906C18.4465 16.0563 17.9295 16.1392 17.3693 16.1392C16.4877 16.1392 15.7022 15.9304 15.0128 15.5128C14.3234 15.0919 13.7798 14.4903 13.3821 13.7081C12.9877 12.9259 12.7905 11.9929 12.7905 10.9091C12.7905 9.82197 12.9893 8.88897 13.3871 8.11008C13.7848 7.32789 14.3284 6.72798 15.0178 6.31037C15.7071 5.88944 16.491 5.67898 17.3693 5.67898C17.9096 5.67898 18.4134 5.75687 18.8807 5.91264C19.3513 6.0651 19.7739 6.29048 20.1484 6.58878C20.523 6.88376 20.8329 7.24503 21.0781 7.67258C21.3234 8.09683 21.4891 8.58239 21.5753 9.12926Z" fill="white"/>
                  <rect id="cc-underline" x="3" y="21" width="18" height="2" rx="1" />
                </g>
              </svg>
            </media-captions-button>

            <!-- Settings Menu Button -->
            <style>
              media-settings-menu-button svg {
                transition: transform 0.1s cubic-bezier(0.4, 0, 1, 1);
                transform: rotateZ(0deg);
              }
              media-settings-menu-button[aria-expanded='true'] svg {
                transform: rotateZ(45deg);
              }
            </style>
            <media-settings-menu-button class="media-button custom-btn">
              <svg slot="icon" viewBox="0 0 24 24">
                <use class="svg-shadow" xlink:href="#settings-icon"></use>
                <path d="M9.98532 6.06614C10.1887 5.15106 11.0003 4.5 11.9377 4.5H12.0623C12.9997 4.5 13.8114 5.15106 14.0147 6.06614L14.1258 6.56613C14.6768 6.78182 15.1869 7.07889 15.6414 7.44254L16.1315 7.28829C17.0257 7.00685 17.9953 7.38421 18.464 8.19602L18.5264 8.30397C18.9951 9.11578 18.837 10.1442 18.1462 10.7778L17.7681 11.1247C17.8111 11.4102 17.8333 11.7025 17.8333 12C17.8333 12.2975 17.8111 12.5898 17.7681 12.8753L18.1462 13.2222C18.837 13.8558 18.9951 14.8842 18.5264 15.696L18.464 15.804C17.9953 16.6158 17.0257 16.9931 16.1315 16.7117L15.6414 16.5575C15.1869 16.9211 14.6768 17.2182 14.1258 17.4339L14.0147 17.9339C13.8114 18.8489 12.9997 19.5 12.0623 19.5H11.9377C11.0003 19.5 10.1887 18.8489 9.98532 17.9339L9.87421 17.4339C9.32327 17.2182 8.81313 16.9211 8.35859 16.5574L7.86848 16.7117C6.97432 16.9931 6.00467 16.6158 5.53597 15.804L5.47365 15.696C5.00495 14.8842 5.16298 13.8558 5.85378 13.2221L6.23191 12.8753C6.18895 12.5898 6.16668 12.2975 6.16668 12C6.16668 11.7025 6.18895 11.4102 6.23192 11.1247L5.85379 10.7778C5.16299 10.1442 5.00496 9.11578 5.47366 8.30397L5.53598 8.19603C6.00468 7.38422 6.97433 7.00686 7.86849 7.28829L8.35859 7.44255C8.81314 7.07889 9.32327 6.78183 9.87421 6.56613L9.98532 6.06614Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12.8333 12C12.8333 12.4602 12.4602 12.8333 12 12.8333C11.5398 12.8333 11.1667 12.4602 11.1667 12C11.1667 11.5398 11.5398 11.1667 12 11.1667C12.4602 11.1667 12.8333 11.5398 12.8333 12Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </media-settings-menu-button>

            <!-- Airplay Button -->
            <media-airplay-button class="media-button custom-btn">
              <svg viewBox="0 0 24 24" aria-hidden="true" slot="icon">
                <g clip-path="url(#clip0_2964_39)">
                <path d="M6 17H5C3.89543 17 3 16.1046 3 15V7C3 5.89543 3.89543 5 5 5H19C20.1046 5 21 5.89543 21 7V15C21 16.1046 20.1046 17 19 17H18M8 20L12 15L16 20H8Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
                <defs>
              </svg>
            </media-airplay-button>

            <!-- Cast Button -->
            <media-cast-button class="media-button custom-btn">
              <svg slot="icon" viewBox="0 0 24 24">
                <use class="svg-shadow" xlink:href="#cast-icon"></use>
                <g id="cast-icon">
                  <path d="M3.75 5.58337H18.25C19.3546 5.58337 20.25 6.4788 20.25 7.58337V16.4167C20.25 17.5213 19.3546 18.4167 18.25 18.4167H15.6667M8.33333 18.4167C8.33333 15.8854 6.28131 13.8334 3.75 13.8334M12 18.4167C12 13.8604 8.30635 10.1667 3.75 10.1667M3.75 17.9584C3.75 18.2115 3.9552 18.4167 4.20833 18.4167C4.46146 18.4167 4.67617 18.1992 4.55462 17.9772C4.47041 17.8233 4.34336 17.6963 4.18953 17.6121C3.96749 17.4905 3.75 17.7052 3.75 17.9584Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
              </svg>
            </media-cast-button>

            <style>
              .custom-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: calc(2 * var(--base));
                height: calc(1.65 * var(--base));
                cursor: pointer;
                border-radius: 9999px;
                transition: opacity .12s ease, box-shadow .2s ease;
              }

              .custom-btn:hover {
                background: rgba(255, 255, 255, 0.1);
              }

              .custom-btn svg {
                width: calc(1.15 * var(--base));
                height: calc(1.15 * var(--base));
                fill: none;
                stroke: var(--_primary-color);
                stroke-width: 1;
                stroke-linecap: round;
                stroke-linejoin: round;
              }
              .custom-btn.custom-play{
                width: calc(1.65 * var(--base));
                height: calc(1.65 * var(--base));
              }
              .custom-btn.custom-play svg {
                width: calc(1.25 * var(--base));
                height: calc(1.25 * var(--base));
              }
            </style>
            <media-theater-mode-button id="media-theater-mode-button" class="media-button custom-btn" type="button" aria-label="theater mode">
              <media-tooltip placement="top">Theater mode</media-tooltip>
              <button style="background-color: transparent; border: none; cursor: pointer; outline: none;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M2 7C2 5.89543 2.89543 5 4 5H20C21.1046 5 22 5.89543 22 7V17C22 18.1046 21.1046 19 20 19H4C2.89543 19 2 18.1046 2 17V7Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M9.33333 9.33325L6 11.9999L9.33333 14.6666M14.6667 14.6666L18 11.9999L14.6667 9.33325" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </media-theater-mode-button>

            <!-- Fullscreen Button -->
            <style>
              /* Having trouble getting @property to work in the shadow dom
                to clean this up. Like https://codepen.io/luwes/pen/oNRyZyx */

              media-fullscreen-button .fs-arrow {
                translate: 0% 0%;
              }
              media-fullscreen-button:hover .fs-arrow {
                translate: -3% -3%;
                transition: translate 0.18s ease;
              }

              media-theater-mode-button button{
                display: grid;
                place-items: center;
              }

              // media-controller:not([breakpointxl]) media-theater-mode-button {
              //   display: none;
              // }

              // media-controller[breakpointxl] media-theater-mode-button {
              //   display: flex;
              // }

              media-fullscreen-button:hover #fs-enter-top,
              media-fullscreen-button:hover #fs-exit-bottom {
                translate: 3% -3%;
                transition: translate 0.18s ease;
              }

              media-fullscreen-button:hover #fs-enter-bottom,
              media-fullscreen-button:hover #fs-exit-top {
                translate: -3% 3%;
                transition: translate 0.18s ease;
              }
            </style>
            <media-fullscreen-button class="media-button custom-btn">
              <svg slot="enter" viewBox="0 0 24 24">
                <use class="svg-shadow" xlink:href="#fs-enter-paths"></use>
                <path d="M5 15.5V17C5 18.1046 5.89543 19 7 19H8.5M19 15.5V17C19 18.1046 18.1046 19 17 19H15.5M5 8.5V7C5 5.89543 5.89543 5 7 5H8.5M19 8.5V7C19 5.89543 18.1046 5 17 5H15.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <svg slot="exit" viewBox="0 0 24 24">
                <use class="svg-shadow" xlink:href="#fs-exit-paths"></use>
                <path d="M8.50001 19.0001L8.50001 17.5001C8.50001 16.3956 7.60458 15.5001 6.50001 15.5001H5.00001M15.5 19.0001V17.5001C15.5 16.3956 16.3954 15.5001 17.5 15.5001L19 15.5001M8.5 5.00012L8.5 6.50012C8.5 7.60469 7.60457 8.50012 6.5 8.50012L5 8.50012M15.5 5.00015L15.5 6.50015C15.5 7.60472 16.3954 8.50015 17.5 8.50015L19 8.50015" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </media-fullscreen-button>
          </div>
        </div>
      </media-control-bar>
    </media-controller>

  `;
}

class MediaTheaterModeButton extends HTMLElement {
  connectedCallback(){
    const isFirefox = /firefox/i.test(globalThis.navigator?.userAgent ?? "");
    const button = this.querySelector("button");
    const syncVisibility = () => {
      const isSmall = globalThis.matchMedia?.("(max-width: 1075px)")?.matches;
      this.classList.toggle("displayNone", !!isSmall);
    };

    if (isFirefox) {
      this.classList.add("displayNone");
      button?.setAttribute("disabled", "true");
      button?.setAttribute("aria-hidden", "true");
      return;
    }

    button?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent('theater-mode', { bubbles: true, composed: true }));
    });

    syncVisibility();

    window.addEventListener("theater-disable", () => {
      this.classList.add("displayNone");
    });

    window.addEventListener("theater-enable", () => {
      this.classList.remove("displayNone");
    });
  }
}
globalThis.customElements.define('media-theater-mode-button', MediaTheaterModeButton);

class MediaCurrentChapter extends HTMLElement {
  connectedCallback(){
    window.addEventListener('player:time', (e) => {
      if(!e.detail.chapterName && this.parentElement.parentElement)
        return this.parentElement.classList.add("displayNone");
      else{
        this.parentElement.classList.remove("displayNone");
        this.querySelector('p').innerHTML = `${e.detail.chapterName ? `${e.detail.chapterIndex} ${e.detail.chapterName}` : "Chapters loading..."}`;
      }
    });

    this.querySelector('p').addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent('open-chapter-menu', { bubbles: true, composed: true }));
    });
  }
}
globalThis.customElements.define('media-current-chapter', MediaCurrentChapter);

class MediaThemeOptiflowzElement extends MediaThemeElement {
  static template = template;

  connectedCallback() {
    super.connectedCallback();

    const controller = this.shadowRoot?.querySelector('media-controller');
    const settingsButton = this.shadowRoot?.querySelector('media-settings-menu-button');

    const closeSettingsMenu = () => {
      if (!settingsButton) return;
      if (settingsButton.getAttribute('aria-expanded') !== 'true') return;
      settingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    };

    const handleFocusOut = () => {
      requestAnimationFrame(() => {
        const active = this.shadowRoot?.activeElement || globalThis.document?.activeElement;
        if (active && controller.contains(active)) return;
        closeSettingsMenu();
      });
    };

    controller?.addEventListener('mouseleave', closeSettingsMenu);
    controller?.addEventListener('focusout', handleFocusOut);

    const observer = new MutationObserver(() => {
      if (controller?.hasAttribute('userinactive')) {
        closeSettingsMenu();
      }
    });

    if (controller) {
      observer.observe(controller, { attributes: true, attributeFilter: ['userinactive'] });
    }

    this._cleanupSettingsMenu = () => {
      controller?.removeEventListener('mouseleave', closeSettingsMenu);
      controller?.removeEventListener('focusout', handleFocusOut);
      observer.disconnect();
    };
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._cleanupSettingsMenu?.();
  }
}

if (globalThis.customElements && !globalThis.customElements.get('media-theme-optiflowz-theme')) {
  globalThis.customElements.define('media-theme-optiflowz-theme', MediaThemeOptiflowzElement);
}

export default MediaThemeOptiflowzElement;

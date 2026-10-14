/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 19 апр. 2020 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_MM_INAUDIOFILESTREAM_H_
#define LSP_PLUG_IN_MM_INAUDIOFILESTREAM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/mm/IInAudioStream.h>
#include <lsp-plug.in/runtime/LSPString.h>

#ifdef USE_LIBSNDFILE
    #include <sndfile.h>
#endif /* USE_LIBSNDFILE */

namespace lsp
{
    namespace mm
    {
    #if defined(PLATFORM_WINDOWS)
        struct WAVEFILE;
    #endif /* PLATFORM_WINDOWS */

        class InAudioFileStream: public IInAudioStream
        {
            protected:
            #if defined(PLATFORM_WINDOWS)
                typedef struct WAVEFILE         handle_t;
            #elif defined(PLATFORM_MACOSX)
                typedef void                    handle_t;
            #else
                typedef SNDFILE                 handle_t;
            #endif

            protected:
                // Platform-specific parameters
                handle_t           *hHandle;
                audio_stream_t      sFormat;
                bool                bSeekable;

            protected:
            #if defined(PLATFORM_WINDOWS)
                ssize_t             read_acm_convert(void *dst, size_t nframes, size_t fmt);
            #elif defined(PLATFORM_MACOSX)
                static status_t     decode_os_status(uint32_t code);
            #else
                static status_t     decode_sf_error(SNDFILE *fd);
            #endif

                virtual ssize_t     direct_read(void *dst, size_t nframes, size_t fmt) override;

                virtual size_t      select_format(size_t fmt) override;

                status_t            do_close();
                static status_t     close_handle(handle_t *h);

            public:
                explicit InAudioFileStream();
                InAudioFileStream(const InAudioFileStream &) = delete;
                InAudioFileStream(InAudioFileStream &&) = delete;
                virtual ~InAudioFileStream() override;

                InAudioFileStream & operator = (const InAudioFileStream &) = delete;
                InAudioFileStream & operator = (InAudioFileStream &&) = delete;

            public:
                /**
                 * Open audio stream
                 * @param path path to the audio file
                 * @return status of operation
                 */
                virtual status_t    open(const char *path);

                /**
                 * Open audio stream
                 * @param path path to the audio file
                 * @return status of operation
                 */
                virtual status_t    open(const LSPString *path);

                /**
                 * Open audio stream
                 * @param path path to the audio file
                 * @return status of operation
                 */
                virtual status_t    open(const io::Path *path);

            public:
                virtual status_t    info(mm::audio_stream_t *dst) const override;
                virtual size_t      sample_rate() const override;
                virtual size_t      channels() const override;
                virtual wssize_t    length() const override;
                virtual size_t      format() const override;

                virtual status_t    close() override;
                virtual wssize_t    skip(wsize_t nframes) override;
                virtual wssize_t    seek(wsize_t nframes) override;
        };
    
    } /* namespace mm */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_MM_INAUDIOFILESTREAM_H_ */

/*
 * Copyright (C) 2022 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2022 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 27 окт. 2022 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_INAUDIOSTREAM_H_
#define LSP_PLUG_IN_FMT_LSPC_INAUDIOSTREAM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/fmt/lspc/AudioReader.h>
#include <lsp-plug.in/mm/IInAudioStream.h>

namespace lsp
{
    namespace lspc
    {
        class InAudioStream: public mm::IInAudioStream
        {
            private:
                InAudioStream(const InAudioStream &);
                InAudioStream &operator = (const InAudioStream &);

            protected:
                AudioReader        *pReader;
                mm::audio_stream_t  sFormat;
                bool                bDelete;

            protected:
                status_t            do_close();

            protected:
                virtual ssize_t     direct_read(void *dst, size_t nframes, size_t fmt) override;
                virtual size_t      select_format(size_t fmt) override;

            public:
                InAudioStream(AudioReader *in, const mm::audio_stream_t *fmt, bool free = false);
                virtual ~InAudioStream() override;

            public:
                virtual status_t    info(mm::audio_stream_t *dst) const override;
                virtual size_t      sample_rate() const override;
                virtual size_t      channels() const override;
                virtual wssize_t    length() const override;
                virtual size_t      format() const override;

                virtual status_t    close() override;
                virtual wssize_t    skip(wsize_t nframes) override;
        };

    } /* namespace lspc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LSPC_INAUDIOSTREAM_H_ */
